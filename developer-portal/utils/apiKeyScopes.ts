/**
 * Scope model and per-tier issuance policy for developer-portal API keys.
 *
 * Pure functions only: the issuance service (services/apiKeyIssuanceService.ts)
 * owns state, this module owns the rules.
 *
 * Scopes are `resource:action`. A `write` scope implies `read` on the same
 * resource, so a key issued with `payments:write` can also read payments.
 */

import type { ApiKey, ApiPermission, Developer } from '../types/developer';

export const ALL_SCOPES: readonly ApiPermission[] = [
  'subscriptions:read',
  'subscriptions:write',
  'payments:read',
  'payments:write',
  'webhooks:read',
  'webhooks:write',
  'analytics:read',
  'users:read',
  'users:write',
  'sandbox:manage',
];

/** Scopes that may only be granted to test-mode keys. */
export const TEST_ONLY_SCOPES: readonly ApiPermission[] = ['sandbox:manage'];

export type DeveloperTier = Developer['tier'];

export interface TierKeyPolicy {
  /** Scopes a key on this tier may be granted. */
  allowedScopes: readonly ApiPermission[];
  /** Maximum simultaneously active keys per developer. */
  maxActiveKeys: number;
  /** Longest lifetime a key may be issued with; also the default. */
  maxTtlDays: number;
}

const READ_SCOPES = ALL_SCOPES.filter((s) => s.endsWith(':read'));

export const TIER_KEY_POLICIES: Record<DeveloperTier, TierKeyPolicy> = {
  free: {
    allowedScopes: [...READ_SCOPES, 'subscriptions:write', 'webhooks:write', 'sandbox:manage'],
    maxActiveKeys: 3,
    maxTtlDays: 90,
  },
  pro: {
    allowedScopes: ALL_SCOPES.filter((s) => s !== 'users:write'),
    maxActiveKeys: 10,
    maxTtlDays: 365,
  },
  enterprise: {
    allowedScopes: ALL_SCOPES,
    maxActiveKeys: 50,
    maxTtlDays: 365,
  },
};

/** Adds implied scopes (`x:write` → `x:read`), de-duplicates and sorts. */
export function normalizeScopes(scopes: readonly ApiPermission[]): ApiPermission[] {
  const set = new Set<ApiPermission>();
  for (const scope of scopes) {
    set.add(scope);
    if (scope.endsWith(':write')) {
      const read = scope.replace(/:write$/, ':read') as ApiPermission;
      if (ALL_SCOPES.includes(read)) set.add(read);
    }
  }
  return ALL_SCOPES.filter((s) => set.has(s));
}

/** Whether a key granted `granted` may perform an operation requiring `required`. */
export function scopeSatisfies(
  granted: readonly ApiPermission[],
  required: ApiPermission
): boolean {
  return normalizeScopes(granted).includes(required);
}

export type IssuanceViolation =
  | { code: 'scope_not_allowed_for_tier'; scopes: ApiPermission[] }
  | { code: 'scope_test_only'; scopes: ApiPermission[] }
  | { code: 'production_requires_active_account' }
  | { code: 'key_limit_reached'; limit: number }
  | { code: 'ttl_exceeds_tier'; maxTtlDays: number }
  | { code: 'invalid_ip_allowlist'; entries: string[] };

export interface IssuanceRequest {
  type: ApiKey['type'];
  scopes: readonly ApiPermission[];
  expiresInDays?: number;
  ipAllowlist?: readonly string[];
}

/**
 * Checks an issuance request against the developer's tier and account state.
 * Returns every violation (empty when the request is allowed) so the caller
 * can report all problems at once.
 */
export function checkIssuancePolicy(
  developer: Pick<Developer, 'tier' | 'status'>,
  request: IssuanceRequest,
  activeKeyCount: number
): IssuanceViolation[] {
  const policy = TIER_KEY_POLICIES[developer.tier];
  const violations: IssuanceViolation[] = [];
  const scopes = normalizeScopes(request.scopes);

  const notAllowed = scopes.filter((s) => !policy.allowedScopes.includes(s));
  if (notAllowed.length > 0) {
    violations.push({ code: 'scope_not_allowed_for_tier', scopes: notAllowed });
  }

  if (request.type === 'production') {
    const testOnly = scopes.filter((s) => TEST_ONLY_SCOPES.includes(s));
    if (testOnly.length > 0) violations.push({ code: 'scope_test_only', scopes: testOnly });
    if (developer.status !== 'active') {
      violations.push({ code: 'production_requires_active_account' });
    }
  }

  if (activeKeyCount >= policy.maxActiveKeys) {
    violations.push({ code: 'key_limit_reached', limit: policy.maxActiveKeys });
  }

  if (request.expiresInDays !== undefined && request.expiresInDays > policy.maxTtlDays) {
    violations.push({ code: 'ttl_exceeds_tier', maxTtlDays: policy.maxTtlDays });
  }

  const badIps = (request.ipAllowlist ?? []).filter((entry) => !isValidIpv4OrCidr(entry));
  if (badIps.length > 0) violations.push({ code: 'invalid_ip_allowlist', entries: badIps });

  return violations;
}

// ── IP allowlist ─────────────────────────────────────────────────────────────

function parseIpv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Accepts `a.b.c.d` or `a.b.c.d/n` (0 ≤ n ≤ 32). */
export function isValidIpv4OrCidr(entry: string): boolean {
  const [ip, bits, ...rest] = entry.split('/');
  if (rest.length > 0 || parseIpv4(ip) === null) return false;
  if (bits === undefined) return true;
  return /^\d{1,2}$/.test(bits) && Number(bits) <= 32;
}

/** Whether `ip` matches any allowlist entry. An empty allowlist allows all. */
export function ipAllowed(
  allowlist: readonly string[] | undefined,
  ip: string | undefined
): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  if (!ip) return false;
  const addr = parseIpv4(ip);
  if (addr === null) return false;
  return allowlist.some((entry) => {
    const [base, bits] = entry.split('/');
    const baseAddr = parseIpv4(base);
    if (baseAddr === null) return false;
    const prefix = bits === undefined ? 32 : Number(bits);
    const size = 2 ** (32 - prefix);
    return Math.floor(addr / size) === Math.floor(baseAddr / size);
  });
}

// ── Secret display ───────────────────────────────────────────────────────────

/** `sk_live_abcd…wxyz`: enough to recognise a key, useless to an attacker. */
export function maskSecret(secret: string): string {
  const prefixEnd = secret.startsWith('sk_') ? secret.indexOf('_', 3) + 1 : 0;
  const body = secret.slice(prefixEnd);
  return `${secret.slice(0, prefixEnd)}${body.slice(0, 4)}…${body.slice(-4)}`;
}
