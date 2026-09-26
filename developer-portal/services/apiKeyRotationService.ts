/**
 * Developer Portal — API Key Rotation Service
 *
 * Issue #1009: Implement API key rotation with grace period
 *
 * Thin portal-facing facade around the shared ApiKeyRotationService that maps
 * between the portal's ApiKey type (developer.ts) and the backend rotation
 * primitives, so portal pages and components stay decoupled from internals.
 */

import {
  ApiKeyRotationService,
  type ManagedApiKey,
  type RotationOptions,
  type RotationResult,
  type ApiKeyValidationResult,
  type ApiKeyRotationMetrics,
} from '../../backend/services/shared/apiKeyRotation';
import type { ApiKey, ApiPermission } from '../types/developer';

// Re-export so portal consumers can import from a single path.
export type {
  RotationOptions,
  RotationResult,
  ApiKeyValidationResult,
  ApiKeyRotationMetrics,
};

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toPortalApiKey(managed: ManagedApiKey): ApiKey {
  return {
    id: managed.id,
    key: managed.key,
    name: managed.name,
    type: managed.environment,
    permissions: managed.permissions as ApiPermission[],
    rateLimit: {
      requestsPerMinute: 60,
      requestsPerHour: 1_000,
      requestsPerDay: 10_000,
      burstLimit: 100,
    },
    usageCount: managed.usageCount,
    status:
      managed.status === 'active' || managed.status === 'grace'
        ? 'active'
        : managed.status === 'expired'
          ? 'expired'
          : 'revoked',
    createdAt: new Date(managed.createdAt),
    expiresAt: managed.expiresAt ? new Date(managed.expiresAt) : undefined,
    revokedAt: managed.revokedAt ? new Date(managed.revokedAt) : undefined,
    lastUsedAt: managed.lastUsedAt ? new Date(managed.lastUsedAt) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Portal API Key Rotation Service
// ---------------------------------------------------------------------------

export class PortalApiKeyRotationService {
  private readonly inner: ApiKeyRotationService;

  constructor(rotationService?: ApiKeyRotationService) {
    this.inner = rotationService ?? new ApiKeyRotationService();
  }

  // ── Key management ────────────────────────────────────────────────────────

  /**
   * Provision a new API key for a developer.
   */
  createKey(
    developerId: string,
    name: string,
    environment: 'test' | 'production',
    permissions: ApiPermission[] = [],
    ttlMs?: number,
  ): ApiKey {
    const managed = this.inner.createKey(developerId, name, environment, permissions, ttlMs);
    return toPortalApiKey(managed);
  }

  /**
   * Rotate an existing key with a configurable grace period.
   *
   * During the grace window both the old and new key are accepted.
   * The portal UI should surface a deprecation banner to the developer.
   *
   * @returns RotationResult containing both the new key and the old key
   *   (now in grace period) along with `gracePeriodEndsAt`.
   */
  async rotateKey(
    keyId: string,
    options: RotationOptions = {},
  ): Promise<{
    newKey: ApiKey;
    oldKey: ApiKey;
    gracePeriodEndsAt: Date;
    gracePeriodRemainingMs: number;
  }> {
    const result = await this.inner.rotateKey(keyId, options);
    return {
      newKey: toPortalApiKey(result.newKey),
      oldKey: toPortalApiKey(result.oldKey),
      gracePeriodEndsAt: new Date(result.gracePeriodEndsAt),
      gracePeriodRemainingMs: result.gracePeriodRemainingMs,
    };
  }

  /**
   * Immediately revoke a key with no grace period.
   */
  revokeKey(keyId: string): boolean {
    return this.inner.revokeKey(keyId);
  }

  /**
   * Revoke all keys for a developer (e.g., on account suspension).
   */
  revokeAllKeys(developerId: string): number {
    return this.inner.revokeAllKeys(developerId);
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Validate a secret key string.
   * Returns `isGrace: true` when the old key is used after rotation so the
   * portal middleware can add a `Deprecation` response header.
   */
  validateKey(secret: string): ApiKeyValidationResult {
    return this.inner.validateKey(secret);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getKey(keyId: string): ApiKey | null {
    const managed = this.inner.getKey(keyId);
    return managed ? toPortalApiKey(managed) : null;
  }

  getKeysByDeveloper(developerId: string): ApiKey[] {
    return this.inner.getKeysByDeveloper(developerId).map(toPortalApiKey);
  }

  getActiveKeysByDeveloper(developerId: string): ApiKey[] {
    return this.inner.getActiveKeysByDeveloper(developerId).map(toPortalApiKey);
  }

  /**
   * Returns rotation history for a developer (audit trail).
   */
  getRotationHistory(developerId?: string) {
    return this.inner.getRotationHistory(developerId);
  }

  /**
   * Returns the grace period status for a key currently mid-rotation.
   */
  getGracePeriodStatus(
    keyId: string,
  ): { gracePeriodEndsAt: Date; remainingMs: number; successorKeyId: string } | null {
    const status = this.inner.getGracePeriodStatus(keyId);
    if (!status) return null;
    return {
      gracePeriodEndsAt: new Date(status.gracePeriodEndsAt),
      remainingMs: status.remainingMs,
      successorKeyId: status.successorKeyId,
    };
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  /**
   * Clean up expired keys. Call periodically (e.g., cron every hour).
   */
  cleanupExpiredKeys(): number {
    return this.inner.cleanupExpiredKeys();
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(): ApiKeyRotationMetrics {
    return this.inner.getMetrics();
  }

  prometheusMetrics(): string {
    return this.inner.prometheusMetrics();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const portalApiKeyRotationService = new PortalApiKeyRotationService();
