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
import { ok, fail, VALIDATION_ERROR, NOT_FOUND, type ActionResult } from './result';
import { withAction, zodIssuesToFieldErrors, portalLogger } from './observability';
import type { ApiKey } from '../types/developer';

// ─────────────────────────────────────────────────────────────────────────────
// createApiKey
// ─────────────────────────────────────────────────────────────────────────────

export async function createApiKeyAction(input: unknown): Promise<ActionResult<ApiKey>> {
  return withAction('apiKey.create', async () => {
    const parsed = createApiKeySchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId, name, type, permissions } = parsed.data;

    const apiKey = await developerPortalService.createApiKey(developerId, name, type, permissions);
    if (!apiKey) {
      return fail(NOT_FOUND, `Developer not found: ${developerId}`);
    }
    portalLogger.info('apiKey.created', { developerId, apiKeyId: apiKey.id, name, type });
    return ok(apiKey);
  });
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
