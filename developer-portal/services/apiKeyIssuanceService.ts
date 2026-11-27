/**
 * Developer Portal — API key issuance with scoped permissions.
 *
 * Source of truth for developer API keys:
 *  - Secrets are 32 random bytes from `crypto`, prefixed `sk_test_` / `sk_live_`.
 *  - Only a SHA-256 hash of the secret is stored. The plaintext is returned
 *    once, at issuance; every stored or listed record carries a masked key.
 *  - Issuance is checked against the developer's tier and account state
 *    (utils/apiKeyScopes.ts): allowed scopes, test-only scopes, active-key
 *    limit, maximum lifetime, IP allowlist syntax.
 *  - `authorize()` is the request-time check an API gateway calls with the
 *    presented secret, the scope the endpoint requires, and the caller's IP.
 *
 * Grace-period rotation stays in services/apiKeyRotationService.ts.
 */

import { createHash, randomBytes, randomUUID } from 'crypto';
import type { ApiKey, ApiPermission, Developer, RateLimit } from '../types/developer';
import {
  TIER_KEY_POLICIES,
  checkIssuancePolicy,
  ipAllowed,
  maskSecret,
  normalizeScopes,
  scopeSatisfies,
  type IssuanceViolation,
} from '../utils/apiKeyScopes';
import { portalLogger } from '../actions/observability';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IssueApiKeyInput {
  name: string;
  type: ApiKey['type'];
  scopes: ApiPermission[];
  rateLimit: RateLimit;
  /** Defaults to the tier's maximum lifetime. */
  expiresInDays?: number;
  /** IPv4 addresses or CIDR ranges; empty or absent allows any IP. */
  ipAllowlist?: string[];
}

export interface IssuedApiKey {
  /** Stored record; `key` is masked. */
  apiKey: ApiKey;
  /** Plaintext secret. Returned only here, never stored. */
  secret: string;
}

export type AuthorizationDenial =
  'invalid_key' | 'revoked' | 'expired' | 'insufficient_scope' | 'ip_not_allowed';

export type AuthorizationResult =
  | { allowed: true; developerId: string; apiKey: ApiKey }
  | { allowed: false; reason: AuthorizationDenial; developerId?: string; apiKeyId?: string };

export class ApiKeyIssuanceError extends Error {
  constructor(readonly violations: IssuanceViolation[]) {
    super(`API key issuance rejected: ${violations.map((v) => v.code).join(', ')}`);
    this.name = 'ApiKeyIssuanceError';
  }
}

interface StoredKey {
  developerId: string;
  secretHash: string;
  apiKey: ApiKey;
}

export interface ApiKeyIssuanceMetrics {
  issued: number;
  rejected: number;
  authorized: number;
  denied: Record<AuthorizationDenial, number>;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export class ApiKeyIssuanceService {
  private readonly keys = new Map<string, StoredKey>();
  private readonly byHash = new Map<string, string>();
  private readonly metrics: ApiKeyIssuanceMetrics = {
    issued: 0,
    rejected: 0,
    authorized: 0,
    denied: { invalid_key: 0, revoked: 0, expired: 0, insufficient_scope: 0, ip_not_allowed: 0 },
  };
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Issues a key, or throws `ApiKeyIssuanceError` listing every policy
   * violation. Requires at least one scope.
   */
  issue(developer: Developer, input: IssueApiKeyInput): IssuedApiKey {
    const scopes = normalizeScopes(input.scopes);
    const violations: IssuanceViolation[] =
      scopes.length === 0 ? [{ code: 'scope_not_allowed_for_tier', scopes: [] }] : [];
    violations.push(
      ...checkIssuancePolicy(developer, { ...input, scopes }, this.activeKeys(developer.id).length)
    );
    if (violations.length > 0) {
      this.metrics.rejected++;
      portalLogger.warn('apiKey.issuance_rejected', {
        developerId: developer.id,
        type: input.type,
        violations: violations.map((v) => v.code),
      });
      throw new ApiKeyIssuanceError(violations);
    }

    const prefix = input.type === 'production' ? 'sk_live_' : 'sk_test_';
    const secret = prefix + randomBytes(32).toString('base64url');
    const now = this.now();
    const ttlDays = input.expiresInDays ?? TIER_KEY_POLICIES[developer.tier].maxTtlDays;

    const apiKey: ApiKey = {
      id: `key_${randomUUID()}`,
      key: maskSecret(secret),
      name: input.name,
      type: input.type,
      permissions: scopes,
      rateLimit: { ...input.rateLimit },
      ipWhitelist: input.ipAllowlist?.length ? [...input.ipAllowlist] : undefined,
      usageCount: 0,
      status: 'active',
      createdAt: new Date(now),
      expiresAt: new Date(now + ttlDays * DAY_MS),
    };

    const secretHash = hashSecret(secret);
    this.keys.set(apiKey.id, { developerId: developer.id, secretHash, apiKey });
    this.byHash.set(secretHash, apiKey.id);
    this.metrics.issued++;
    portalLogger.info('apiKey.issued', {
      developerId: developer.id,
      apiKeyId: apiKey.id,
      type: apiKey.type,
      scopes,
      expiresAt: apiKey.expiresAt?.toISOString(),
      ipRestricted: Boolean(apiKey.ipWhitelist),
    });
    return { apiKey, secret };
  }

  /** Revokes a developer's key. Returns false for unknown or foreign keys. */
  revoke(developerId: string, apiKeyId: string): boolean {
    const stored = this.keys.get(apiKeyId);
    if (!stored || stored.developerId !== developerId) return false;
    if (stored.apiKey.status !== 'revoked') {
      stored.apiKey.status = 'revoked';
      stored.apiKey.revokedAt = new Date(this.now());
      portalLogger.info('apiKey.revoked', { developerId, apiKeyId });
    }
    return true;
  }

  /** A developer's keys, newest first, with expiry applied. */
  list(developerId: string): ApiKey[] {
    return [...this.keys.values()]
      .filter((k) => k.developerId === developerId)
      .map((k) => this.refreshExpiry(k).apiKey)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  activeKeys(developerId: string): ApiKey[] {
    return this.list(developerId).filter((k) => k.status === 'active');
  }

  /**
   * Request-time check: is `secret` a live key that grants `requiredScope`
   * from `ip`? Records usage on success.
   */
  authorize(secret: string, requiredScope: ApiPermission, ip?: string): AuthorizationResult {
    const id = this.byHash.get(hashSecret(secret));
    const stored = id ? this.keys.get(id) : undefined;
    if (!stored) return this.deny('invalid_key');

    const { apiKey, developerId } = this.refreshExpiry(stored);
    if (apiKey.status === 'revoked') return this.deny('revoked', developerId, apiKey.id);
    if (apiKey.status === 'expired') return this.deny('expired', developerId, apiKey.id);
    if (!scopeSatisfies(apiKey.permissions, requiredScope)) {
      return this.deny('insufficient_scope', developerId, apiKey.id, requiredScope);
    }
    if (!ipAllowed(apiKey.ipWhitelist, ip)) {
      return this.deny('ip_not_allowed', developerId, apiKey.id);
    }

    apiKey.usageCount++;
    apiKey.lastUsedAt = new Date(this.now());
    if (ip) apiKey.lastUsedIp = ip;
    this.metrics.authorized++;
    return { allowed: true, developerId, apiKey };
  }

  getMetrics(): ApiKeyIssuanceMetrics {
    return { ...this.metrics, denied: { ...this.metrics.denied } };
  }

  /** Prometheus text exposition of issuance and authorization counters. */
  toPrometheus(): string {
    const m = this.metrics;
    const lines = [
      '# HELP developer_portal_api_keys_issued_total API keys issued',
      '# TYPE developer_portal_api_keys_issued_total counter',
      `developer_portal_api_keys_issued_total ${m.issued}`,
      '# HELP developer_portal_api_keys_rejected_total API key issuance requests rejected by policy',
      '# TYPE developer_portal_api_keys_rejected_total counter',
      `developer_portal_api_keys_rejected_total ${m.rejected}`,
      '# HELP developer_portal_api_key_authorizations_total API key authorization checks',
      '# TYPE developer_portal_api_key_authorizations_total counter',
      `developer_portal_api_key_authorizations_total{result="allowed"} ${m.authorized}`,
      ...Object.entries(m.denied).map(
        ([reason, n]) =>
          `developer_portal_api_key_authorizations_total{result="denied",reason="${reason}"} ${n}`
      ),
    ];
    return lines.join('\n') + '\n';
  }

  private refreshExpiry(stored: StoredKey): StoredKey {
    const { apiKey } = stored;
    if (
      apiKey.status === 'active' &&
      apiKey.expiresAt &&
      apiKey.expiresAt.getTime() <= this.now()
    ) {
      apiKey.status = 'expired';
    }
    return stored;
  }

  private deny(
    reason: AuthorizationDenial,
    developerId?: string,
    apiKeyId?: string,
    requiredScope?: ApiPermission
  ): AuthorizationResult {
    this.metrics.denied[reason]++;
    portalLogger.warn('apiKey.authorization_denied', {
      reason,
      developerId,
      apiKeyId,
      requiredScope,
    });
    return { allowed: false, reason, developerId, apiKeyId };
  }
}

export const apiKeyIssuanceService = new ApiKeyIssuanceService();

// Same registration pattern as actions/observability.ts: included in the
// backend /metrics scrape when the exporter is present, skipped otherwise.
try {
  const { defaultExporter } = require('../../backend/monitoring/prometheusMetricsExporter');
  defaultExporter.register({
    name: 'developer-portal-api-keys',
    collector: () => apiKeyIssuanceService.toPrometheus(),
  });
} catch {
  // Exporter not available (e.g. React Native bundle).
}
