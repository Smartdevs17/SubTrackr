/**
 * API key issuance with scoped permissions.
 *
 * Covers the scope model and tier policy (utils/apiKeyScopes.ts), the
 * issuance service (services/apiKeyIssuanceService.ts) and the
 * createApiKeyAction error mapping.
 */

jest.mock(
  '../../sandbox/services/sandboxService',
  () => ({
    sandboxService: {
      createEnvironment: jest.fn().mockResolvedValue({ id: 'env-stub', name: 'stub' }),
    },
  }),
  { virtual: true }
);

import {
  checkIssuancePolicy,
  ipAllowed,
  isValidIpv4OrCidr,
  maskSecret,
  normalizeScopes,
  scopeSatisfies,
  TIER_KEY_POLICIES,
} from '../utils/apiKeyScopes';
import {
  ApiKeyIssuanceError,
  ApiKeyIssuanceService,
  hashSecret,
} from '../services/apiKeyIssuanceService';
import {
  createApiKeyAction,
  getApiKeysAction,
  registerDeveloperAction,
  revokeApiKeyAction,
} from '../actions';
import { developerPortalService } from '../services/developerPortalService';
import { CONFLICT, FORBIDDEN, VALIDATION_ERROR } from '../actions/result';
import type { Developer, RateLimit } from '../types/developer';

const DAY = 24 * 60 * 60 * 1000;
const RATE: RateLimit = {
  requestsPerMinute: 20,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  burstLimit: 50,
};

function developer(overrides: Partial<Developer> = {}): Developer {
  return {
    id: `dev_${Math.random().toString(36).slice(2)}`,
    email: 'dev@example.com',
    name: 'Dev',
    status: 'active',
    tier: 'pro',
    onboardingStatus: { step: 'completed', completedSteps: [], startedAt: new Date() },
    apiKeys: [],
    sandboxEnvironments: [],
    usage: {} as Developer['usage'],
    billing: {} as Developer['billing'],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope model
// ─────────────────────────────────────────────────────────────────────────────

describe('scope model', () => {
  it('makes write imply read, de-duplicates and orders scopes', () => {
    expect(normalizeScopes(['payments:write', 'payments:read', 'analytics:read'])).toEqual([
      'payments:read',
      'payments:write',
      'analytics:read',
    ]);
  });

  it('checks a required scope against granted scopes', () => {
    expect(scopeSatisfies(['subscriptions:write'], 'subscriptions:read')).toBe(true);
    expect(scopeSatisfies(['subscriptions:read'], 'subscriptions:write')).toBe(false);
    expect(scopeSatisfies(['subscriptions:write'], 'payments:read')).toBe(false);
  });

  it('masks secrets but keeps them recognisable', () => {
    expect(maskSecret('sk_live_abcdefghijklmnop')).toBe('sk_live_abcd…mnop');
    expect(maskSecret('sk_test_0123456789')).toBe('sk_test_0123…6789');
  });
});

describe('IP allowlist', () => {
  it('validates IPv4 addresses and CIDR ranges', () => {
    expect(isValidIpv4OrCidr('203.0.113.7')).toBe(true);
    expect(isValidIpv4OrCidr('10.0.0.0/8')).toBe(true);
    expect(isValidIpv4OrCidr('10.0.0.0/33')).toBe(false);
    expect(isValidIpv4OrCidr('256.0.0.1')).toBe(false);
    expect(isValidIpv4OrCidr('example.com')).toBe(false);
    expect(isValidIpv4OrCidr('1.2.3.4/8/1')).toBe(false);
  });

  it('matches exact addresses and ranges', () => {
    const allow = ['203.0.113.7', '10.1.0.0/16'];
    expect(ipAllowed(allow, '203.0.113.7')).toBe(true);
    expect(ipAllowed(allow, '10.1.255.3')).toBe(true);
    expect(ipAllowed(allow, '10.2.0.1')).toBe(false);
    expect(ipAllowed(allow, undefined)).toBe(false);
    expect(ipAllowed(allow, '::1')).toBe(false);
    expect(ipAllowed(undefined, '1.2.3.4')).toBe(true);
    expect(ipAllowed(['0.0.0.0/0'], '8.8.8.8')).toBe(true);
  });
});

describe('tier policy', () => {
  const request = { type: 'test' as const, scopes: ['subscriptions:read' as const] };

  it('allows a request within the tier', () => {
    expect(checkIssuancePolicy({ tier: 'free', status: 'pending' }, request, 0)).toEqual([]);
  });

  it('rejects scopes above the tier, including implied ones', () => {
    const [v] = checkIssuancePolicy(
      { tier: 'free', status: 'active' },
      { ...request, scopes: ['payments:write'] },
      0
    );
    expect(v).toEqual({ code: 'scope_not_allowed_for_tier', scopes: ['payments:write'] });
    expect(
      checkIssuancePolicy(
        { tier: 'pro', status: 'active' },
        { ...request, scopes: ['users:write'] },
        0
      )
    ).toEqual([{ code: 'scope_not_allowed_for_tier', scopes: ['users:write'] }]);
  });

  it('keeps sandbox scopes and unverified accounts off production keys', () => {
    const codes = checkIssuancePolicy(
      { tier: 'enterprise', status: 'pending' },
      { type: 'production', scopes: ['sandbox:manage'] },
      0
    ).map((v) => v.code);
    expect(codes).toEqual(['scope_test_only', 'production_requires_active_account']);
  });

  it('enforces the active-key limit and maximum lifetime', () => {
    const codes = checkIssuancePolicy(
      { tier: 'free', status: 'active' },
      { ...request, expiresInDays: 91, ipAllowlist: ['nope'] },
      TIER_KEY_POLICIES.free.maxActiveKeys
    ).map((v) => v.code);
    expect(codes).toEqual(['key_limit_reached', 'ttl_exceeds_tier', 'invalid_ip_allowlist']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issuance service
// ─────────────────────────────────────────────────────────────────────────────

describe('ApiKeyIssuanceService', () => {
  let clock: number;
  let svc: ApiKeyIssuanceService;
  beforeEach(() => {
    clock = Date.UTC(2026, 0, 1);
    svc = new ApiKeyIssuanceService({ now: () => clock });
  });

  const issue = (
    dev: Developer,
    extra: Partial<Parameters<ApiKeyIssuanceService['issue']>[1]> = {}
  ) =>
    svc.issue(dev, {
      name: 'k',
      type: 'production',
      scopes: ['payments:write'],
      rateLimit: RATE,
      ...extra,
    });

  it('returns the secret once and stores only a masked key and hash', () => {
    const dev = developer();
    const { apiKey, secret } = issue(dev);

    expect(secret).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
    expect(apiKey.key).toBe(maskSecret(secret));
    expect(apiKey.key).not.toContain(secret.slice(12, -4));
    expect(apiKey.permissions).toEqual(['payments:read', 'payments:write']);
    expect(svc.list(dev.id)[0].key).toBe(apiKey.key);
    expect(JSON.stringify(svc.list(dev.id))).not.toContain(secret);
    expect(hashSecret(secret)).toHaveLength(64);
  });

  it('generates unique secrets and ids', () => {
    const dev = developer({ tier: 'enterprise' });
    const a = issue(dev);
    const b = issue(dev);
    expect(a.secret).not.toBe(b.secret);
    expect(a.apiKey.id).not.toBe(b.apiKey.id);
  });

  it('defaults expiry to the tier maximum and honours a shorter lifetime', () => {
    const dev = developer({ tier: 'free' });
    expect(
      issue(dev, { type: 'test', scopes: ['subscriptions:read'] }).apiKey.expiresAt!.getTime()
    ).toBe(clock + 90 * DAY);
    const short = issue(dev, { type: 'test', scopes: ['subscriptions:read'], expiresInDays: 7 });
    expect(short.apiKey.expiresAt!.getTime()).toBe(clock + 7 * DAY);
  });

  it('rejects requests that break the policy, listing every violation', () => {
    const dev = developer({ tier: 'free', status: 'pending' });
    let error: unknown;
    try {
      issue(dev, { scopes: ['users:write', 'sandbox:manage'] });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ApiKeyIssuanceError);
    expect((error as ApiKeyIssuanceError).violations.map((v) => v.code)).toEqual([
      'scope_not_allowed_for_tier',
      'scope_test_only',
      'production_requires_active_account',
    ]);
    expect(svc.list(dev.id)).toHaveLength(0);
    expect(svc.getMetrics().rejected).toBe(1);
  });

  it('rejects a key with no scopes', () => {
    expect(() => issue(developer(), { scopes: [] })).toThrow(ApiKeyIssuanceError);
  });

  it('counts only active keys towards the limit', () => {
    const dev = developer({ tier: 'free' });
    const test = { type: 'test' as const, scopes: ['subscriptions:read' as const] };
    const keys = [issue(dev, test), issue(dev, test), issue(dev, test)];
    expect(() => issue(dev, test)).toThrow(/key_limit_reached/);
    svc.revoke(dev.id, keys[0].apiKey.id);
    expect(() => issue(dev, test)).not.toThrow();
  });

  describe('authorize', () => {
    it('allows a live key with the required scope and records usage', () => {
      const dev = developer();
      const { secret, apiKey } = issue(dev);
      clock += 1000;
      const result = svc.authorize(secret, 'payments:read', '198.51.100.1');
      expect(result).toMatchObject({ allowed: true, developerId: dev.id });
      expect(apiKey.usageCount).toBe(1);
      expect(apiKey.lastUsedAt!.getTime()).toBe(clock);
      expect(apiKey.lastUsedIp).toBe('198.51.100.1');
    });

    it('denies unknown, under-scoped, revoked and expired keys', () => {
      const dev = developer();
      const { secret, apiKey } = issue(dev, { expiresInDays: 30 });

      expect(svc.authorize('sk_live_forged', 'payments:read')).toEqual({
        allowed: false,
        reason: 'invalid_key',
        developerId: undefined,
        apiKeyId: undefined,
      });
      expect(svc.authorize(secret, 'users:read')).toMatchObject({
        allowed: false,
        reason: 'insufficient_scope',
      });

      clock += 30 * DAY;
      expect(svc.authorize(secret, 'payments:read')).toMatchObject({ reason: 'expired' });
      expect(svc.list(dev.id)[0].status).toBe('expired');

      const other = issue(dev);
      svc.revoke(dev.id, other.apiKey.id);
      expect(svc.authorize(other.secret, 'payments:read')).toMatchObject({ reason: 'revoked' });
      expect(apiKey.usageCount).toBe(0);
      expect(svc.getMetrics().denied).toMatchObject({
        invalid_key: 1,
        insufficient_scope: 1,
        expired: 1,
        revoked: 1,
      });
    });

    it('enforces the IP allowlist', () => {
      const { secret } = issue(developer(), { ipAllowlist: ['10.0.0.0/8'] });
      expect(svc.authorize(secret, 'payments:read', '10.4.5.6').allowed).toBe(true);
      expect(svc.authorize(secret, 'payments:read', '192.168.1.1')).toMatchObject({
        reason: 'ip_not_allowed',
      });
      expect(svc.authorize(secret, 'payments:read')).toMatchObject({ reason: 'ip_not_allowed' });
    });
  });

  it('will not revoke another developer’s key', () => {
    const owner = developer();
    const { apiKey } = issue(owner);
    expect(svc.revoke('someone-else', apiKey.id)).toBe(false);
    expect(svc.list(owner.id)[0].status).toBe('active');
  });

  it('exports Prometheus counters', () => {
    const { secret } = issue(developer());
    svc.authorize(secret, 'payments:read');
    svc.authorize('bad', 'payments:read');
    const text = svc.toPrometheus();
    expect(text).toContain('developer_portal_api_keys_issued_total 1');
    expect(text).toContain('developer_portal_api_key_authorizations_total{result="allowed"} 1');
    expect(text).toContain(
      'developer_portal_api_key_authorizations_total{result="denied",reason="invalid_key"} 1'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server action
// ─────────────────────────────────────────────────────────────────────────────

describe('createApiKeyAction with scoped permissions', () => {
  async function newDeveloper(email: string, overrides: Partial<Developer> = {}) {
    const dev = await registerDeveloperAction({ email, name: 'Portal User' });
    if (!dev.ok) throw new Error('registration failed');
    if (Object.keys(overrides).length) {
      await developerPortalService.updateDeveloper(dev.data.id, overrides);
    }
    return dev.data.id;
  }

  it('returns the secret once; listings are masked', async () => {
    const developerId = await newDeveloper('scoped-once@example.com');
    const created = await createApiKeyAction({
      developerId,
      name: 'CI',
      type: 'test',
      permissions: ['subscriptions:write'],
      expiresInDays: 30,
      ipAllowlist: ['203.0.113.0/24'],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.key).toMatch(/^sk_test_/);
    expect(created.data.permissions).toEqual(['subscriptions:read', 'subscriptions:write']);
    expect(created.data.ipWhitelist).toEqual(['203.0.113.0/24']);

    const listed = await getApiKeysAction({ developerId });
    expect(listed.ok && listed.data[0].key).toBe(maskSecret(created.data.key));
  });

  it('maps tier and account violations to FORBIDDEN with field errors', async () => {
    const developerId = await newDeveloper('scoped-forbidden@example.com');
    const result = await createApiKeyAction({
      developerId,
      name: 'Live',
      type: 'production',
      permissions: ['payments:write'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(FORBIDDEN);
    expect(result.error.fieldErrors!.map((e) => e.path)).toEqual(['permissions', 'type']);
  });

  it('maps the key limit to CONFLICT and lets a revoke free a slot', async () => {
    const developerId = await newDeveloper('scoped-limit@example.com');
    const input = { developerId, name: 'k', type: 'test', permissions: ['analytics:read'] };
    const first = await createApiKeyAction(input);
    await createApiKeyAction(input);
    await createApiKeyAction(input);

    const blocked = await createApiKeyAction(input);
    expect(!blocked.ok && blocked.error.code).toBe(CONFLICT);

    if (first.ok) await revokeApiKeyAction({ developerId, apiKeyId: first.data.id });
    expect((await createApiKeyAction(input)).ok).toBe(true);
  });

  it('maps a malformed IP allowlist to VALIDATION_ERROR', async () => {
    const developerId = await newDeveloper('scoped-ip@example.com');
    const result = await createApiKeyAction({
      developerId,
      name: 'k',
      type: 'test',
      permissions: ['analytics:read'],
      ipAllowlist: ['10.0.0.300'],
    });
    expect(!result.ok && result.error.code).toBe(VALIDATION_ERROR);
    expect(!result.ok && result.error.fieldErrors![0].path).toBe('ipAllowlist');
  });

  it('issues production keys for verified accounts on a paid tier', async () => {
    const developerId = await newDeveloper('scoped-live@example.com', {
      status: 'active',
      tier: 'pro',
    });
    const result = await createApiKeyAction({
      developerId,
      name: 'Live',
      type: 'production',
      permissions: ['payments:write'],
      expiresInDays: 365,
    });
    expect(result.ok && result.data.key).toMatch(/^sk_live_/);
  });
});
