'use server';

/**
 * API key server actions.
 *
 * Issue #2061 — Refactor developer portal onto typed server actions.
 *
 * Wraps DeveloperLifecycleService key CRUD and PortalApiKeyRotationService
 * rotation with zod-validated inputs, typed results, and observability.
 */

import { developerPortalService } from '../services/developerPortalService';
import { portalApiKeyRotationService } from '../services/apiKeyRotationService';
import {
  createApiKeySchema,
  revokeApiKeySchema,
  rotateApiKeySchema,
  getApiKeysSchema,
} from './schemas';
import {
  ok,
  fail,
  VALIDATION_ERROR,
  NOT_FOUND,
  CONFLICT,
  FORBIDDEN,
  type ActionResult,
  type ActionFailure,
} from './result';
import { withAction, zodIssuesToFieldErrors, portalLogger } from './observability';
import { ApiKeyIssuanceError } from '../services/apiKeyIssuanceService';
import type { IssuanceViolation } from '../utils/apiKeyScopes';
import type { ApiKey } from '../types/developer';

// ─────────────────────────────────────────────────────────────────────────────
// createApiKey
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issues a scoped API key. On success `data.key` holds the plaintext secret;
 * it is never returned again (listings show a masked key).
 *
 * Policy failures map to: invalid IP allowlist → VALIDATION_ERROR,
 * active-key limit → CONFLICT, anything else the tier or account state does
 * not permit → FORBIDDEN. `fieldErrors` names each violation.
 */
export async function createApiKeyAction(input: unknown): Promise<ActionResult<ApiKey>> {
  return withAction('apiKey.create', async () => {
    const parsed = createApiKeySchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId, name, type, permissions, expiresInDays, ipAllowlist } = parsed.data;

    let apiKey: ApiKey | null;
    try {
      apiKey = await developerPortalService.createApiKey(developerId, name, type, permissions, {
        expiresInDays,
        ipAllowlist,
      });
    } catch (err) {
      if (err instanceof ApiKeyIssuanceError) return issuanceFailure(err);
      throw err;
    }
    if (!apiKey) {
      return fail(NOT_FOUND, `Developer not found: ${developerId}`);
    }
    portalLogger.info('apiKey.created', {
      developerId,
      apiKeyId: apiKey.id,
      name,
      type,
      scopes: apiKey.permissions,
    });
    return ok(apiKey);
  });
}

const VIOLATION_FIELD: Record<IssuanceViolation['code'], string> = {
  scope_not_allowed_for_tier: 'permissions',
  scope_test_only: 'permissions',
  production_requires_active_account: 'type',
  key_limit_reached: 'developerId',
  ttl_exceeds_tier: 'expiresInDays',
  invalid_ip_allowlist: 'ipAllowlist',
};

function describeViolation(v: IssuanceViolation): string {
  switch (v.code) {
    case 'scope_not_allowed_for_tier':
      return v.scopes.length
        ? `Not available on your plan: ${v.scopes.join(', ')}`
        : 'At least one permission is required';
    case 'scope_test_only':
      return `Only allowed on test keys: ${v.scopes.join(', ')}`;
    case 'production_requires_active_account':
      return 'Production keys require a verified, active account';
    case 'key_limit_reached':
      return `Active key limit reached (${v.limit}); revoke a key first`;
    case 'ttl_exceeds_tier':
      return `Maximum key lifetime on your plan is ${v.maxTtlDays} days`;
    case 'invalid_ip_allowlist':
      return `Invalid IPv4 address or CIDR range: ${v.entries.join(', ')}`;
  }
}

function issuanceFailure(err: ApiKeyIssuanceError): ActionFailure {
  const codes = err.violations.map((v) => v.code);
  const code = codes.every((c) => c === 'invalid_ip_allowlist')
    ? VALIDATION_ERROR
    : codes.includes('key_limit_reached') && codes.length === 1
      ? CONFLICT
      : FORBIDDEN;
  return fail(
    code,
    'API key request not permitted',
    err.violations.map((v) => ({ path: VIOLATION_FIELD[v.code], message: describeViolation(v) }))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// revokeApiKey
// ─────────────────────────────────────────────────────────────────────────────

export async function revokeApiKeyAction(
  input: unknown
): Promise<ActionResult<{ revoked: boolean }>> {
  return withAction('apiKey.revoke', async () => {
    const parsed = revokeApiKeySchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId, apiKeyId } = parsed.data;

    const revoked = await developerPortalService.revokeApiKey(developerId, apiKeyId);
    if (!revoked) {
      return fail(NOT_FOUND, `API key not found: ${apiKeyId}`);
    }
    portalLogger.info('apiKey.revoked', { developerId, apiKeyId });
    return ok({ revoked: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// rotateApiKey
// ─────────────────────────────────────────────────────────────────────────────

export async function rotateApiKeyAction(input: unknown): Promise<
  ActionResult<{
    newKey: ApiKey;
    oldKey: ApiKey;
    gracePeriodEndsAt: Date;
    gracePeriodRemainingMs: number;
  }>
> {
  return withAction('apiKey.rotate', async () => {
    const parsed = rotateApiKeySchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { apiKeyId, gracePeriodMs, reason } = parsed.data;

    const existingKey = portalApiKeyRotationService.getKey(apiKeyId);
    if (!existingKey) {
      return fail(NOT_FOUND, `API key not found: ${apiKeyId}`);
    }

    const result = await portalApiKeyRotationService.rotateKey(apiKeyId, {
      gracePeriodMs,
      reason,
    });
    portalLogger.info('apiKey.rotated', {
      oldKeyId: apiKeyId,
      newKeyId: result.newKey.id,
      reason,
    });
    return ok(result);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getApiKeys
// ─────────────────────────────────────────────────────────────────────────────

export async function getApiKeysAction(input: unknown): Promise<ActionResult<ApiKey[]>> {
  return withAction('apiKey.list', async () => {
    const parsed = getApiKeysSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId } = parsed.data;

    // Return an empty array for unknown developers rather than an error,
    // matching the underlying service's behaviour.
    const keys = await developerPortalService.getApiKeys(developerId);
    return ok(keys);
  });
}
