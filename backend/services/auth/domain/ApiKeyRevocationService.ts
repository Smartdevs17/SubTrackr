/**
 * API Key Revocation & Leak Detection Service — SubTrackr
 *
 * Issue #1273: Build API key revocation with leak detection
 *
 * Features:
 *   - Immediate revocation of a single key or every key a merchant owns
 *   - Exposure detection by scanning arbitrary content (commits, pastes, logs,
 *     support tickets) for secrets matching the SubTrackr key format; each
 *     candidate is hashed and matched against stored key hashes, so raw
 *     secrets never need to be kept server-side
 *   - Breach-feed ingestion by SHA-256 digest only (for partners that do not
 *     share raw secrets)
 *   - Usage anomaly detection (distinct client IPs / request bursts inside a
 *     sliding window)
 *   - Per-merchant policy: auto-revoke on exposure (default) and optionally on
 *     anomaly; otherwise incidents are flagged for review
 *   - Incident lifecycle (open → revoked / dismissed, or auto_revoked)
 *   - Append-only audit trail and domain events (`auth.api_key_revoked`,
 *     `auth.api_key_leak_detected`)
 */

import { randomBytes } from 'crypto';
import { AuthError } from '../errors';
import { logger } from '../../shared/logging';
import { eventBus, buildEvent } from '../../shared/events';
import { apiKeyRotationService, hashApiKey } from './ApiKeyRotationService';
import type {
  ApiKeyRecord,
  ApiKeyRevocationAuditEntry,
  ApiKeyUsageEvent,
  LeakDetectionMethod,
  LeakDetectionPolicy,
  LeakIncident,
  LeakIncidentSeverity,
  LeakIncidentStatus,
  LeakScanResult,
} from '../interfaces';

/** Matches `sk_…`, `sk_live_…` and `sk_test_…` secrets. */
const API_KEY_PATTERN = /\bsk_[A-Za-z0-9_-]{16,}/g;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_SCAN_LENGTH = 5 * 1024 * 1024;
const MAX_AUDIT_ENTRIES = 50_000;
const SYSTEM_ACTOR = 'system:leak-detector';

export const DEFAULT_LEAK_DETECTION_POLICY: LeakDetectionPolicy = {
  autoRevokeOnExposure: true,
  autoRevokeOnAnomaly: false,
  anomalyWindowMs: 60 * 60 * 1000,
  maxDistinctIps: 10,
  maxRequestsPerWindow: 10_000,
};

/** The subset of key storage the revocation service depends on. */
export interface RevocableKeyStore {
  getKey(keyId: string): ApiKeyRecord | undefined;
  findKeyIdByHash(keyHash: string): string | null;
  listKeyIds(merchantId?: string): string[];
  revokeKey(keyId: string, reason?: string): Promise<ApiKeyRecord>;
}

interface UsageWindow {
  requests: number[];
  ips: Map<string, number>; // ip → last seen timestamp
}

export function redactApiKey(rawKey: string): string {
  if (rawKey.length <= 12) return `${rawKey.slice(0, 3)}…`;
  return `${rawKey.slice(0, 8)}…${rawKey.slice(-4)}`;
}

export class ApiKeyRevocationService {
  private incidents = new Map<string, LeakIncident>();
  private auditLog: ApiKeyRevocationAuditEntry[] = [];
  private policies = new Map<string, LeakDetectionPolicy>();
  private usage = new Map<string, UsageWindow>();

  constructor(
    private readonly keyStore: RevocableKeyStore = apiKeyRotationService,
    defaultPolicy: Partial<LeakDetectionPolicy> = {}
  ) {
    this.policies.set('default', { ...DEFAULT_LEAK_DETECTION_POLICY, ...defaultPolicy });
  }

  // ── Revocation ───────────────────────────────────────────────────────────

  /**
   * Revoke a key immediately and close its open incidents. `incidentId` is set
   * when the revocation was triggered automatically by that incident.
   */
  async revokeKey(
    keyId: string,
    options: { reason: string; actorId: string; incidentId?: string }
  ): Promise<ApiKeyRecord> {
    const record = await this.keyStore.revokeKey(keyId, options.reason);

    this.closeIncidentsForKey(keyId, options.actorId, options.incidentId);
    this.audit({
      keyId,
      merchantId: record.merchantId,
      action: 'revoked',
      actorId: options.actorId,
      reason: options.reason,
      incidentId: options.incidentId ?? null,
    });
    this.usage.delete(keyId);

    await this.publishSafely(
      buildEvent(
        'auth',
        'api_key_revoked',
        {
          keyId,
          merchantId: record.merchantId,
          reason: options.reason,
          revokedBy: options.actorId,
          revokedAt: Date.now(),
        },
        { aggregateId: record.merchantId }
      )
    );

    return record;
  }

  /** Revoke every non-revoked key owned by a merchant. Returns the number revoked. */
  async revokeAllForMerchant(
    merchantId: string,
    options: { reason: string; actorId: string }
  ): Promise<number> {
    let count = 0;
    for (const keyId of this.keyStore.listKeyIds(merchantId)) {
      if (this.keyStore.getKey(keyId)?.status === 'revoked') continue;
      await this.revokeKey(keyId, options);
      count++;
    }
    return count;
  }

  // ── Leak detection ───────────────────────────────────────────────────────

  /**
   * Scan free-form content for SubTrackr API keys. Any candidate whose hash
   * matches a live key raises an incident (and is revoked when the merchant
   * policy enables `autoRevokeOnExposure`).
   */
  async scanForLeaks(content: string, source: string): Promise<LeakScanResult> {
    if (typeof content !== 'string') throw new Error('content must be a string');
    if (content.length > MAX_SCAN_LENGTH)
      throw new Error(`content exceeds ${MAX_SCAN_LENGTH} characters`);

    const candidates = new Set(content.match(API_KEY_PATTERN) ?? []);
    const incidents: LeakIncident[] = [];

    for (const candidate of candidates) {
      const keyId = this.keyStore.findKeyIdByHash(hashApiKey(candidate));
      if (!keyId) continue;
      const incident = await this.handleExposure(
        keyId,
        'pattern_scan',
        source,
        redactApiKey(candidate)
      );
      if (incident) incidents.push(incident);
    }

    return { scannedCandidates: candidates.size, incidents };
  }

  /** Ingest SHA-256 (hex) digests of exposed keys from an external breach feed. */
  async checkLeakedHashes(hashes: string[], source: string): Promise<LeakScanResult> {
    if (!Array.isArray(hashes)) throw new Error('hashes must be an array');

    const unique = new Set(
      hashes
        .filter((h) => typeof h === 'string' && SHA256_HEX_PATTERN.test(h))
        .map((h) => h.toLowerCase())
    );
    const incidents: LeakIncident[] = [];

    for (const hash of unique) {
      const keyId = this.keyStore.findKeyIdByHash(hash);
      if (!keyId) continue;
      const record = this.keyStore.getKey(keyId);
      const incident = await this.handleExposure(
        keyId,
        'hash_match',
        source,
        `${record?.keyPrefix ?? 'sk_'}…`
      );
      if (incident) incidents.push(incident);
    }

    return { scannedCandidates: unique.size, incidents };
  }

  /** Manually report a key as leaked (e.g. merchant noticed it in a screenshot). */
  async reportLeak(
    keyId: string,
    options: { source: string; actorId: string }
  ): Promise<LeakIncident> {
    const record = this.keyStore.getKey(keyId);
    if (!record) throw AuthError.apiKeyNotFound(keyId);
    if (record.status === 'revoked') throw AuthError.apiKeyAlreadyRevoked(keyId);

    const incident = await this.handleExposure(
      keyId,
      'manual_report',
      options.source,
      `${record.keyPrefix}…`,
      options.actorId
    );
    // handleExposure only returns null for revoked keys, which is checked above.
    return incident as LeakIncident;
  }

  /**
   * Record a successful request made with a key and evaluate usage anomalies.
   * Returns the incident raised (if any).
   */
  async recordUsage(event: ApiKeyUsageEvent): Promise<LeakIncident | null> {
    const record = this.keyStore.getKey(event.keyId);
    if (!record || record.status === 'revoked') return null;

    const policy = this.getPolicy(record.merchantId);
    const now = event.timestamp ?? Date.now();
    const windowStart = now - policy.anomalyWindowMs;

    const window = this.usage.get(event.keyId) ?? { requests: [], ips: new Map<string, number>() };
    window.requests = window.requests.filter((t) => t > windowStart);
    window.requests.push(now);
    for (const [ip, seenAt] of window.ips) {
      if (seenAt <= windowStart) window.ips.delete(ip);
    }
    window.ips.set(event.ip, now);
    this.usage.set(event.keyId, window);

    const reasons: string[] = [];
    if (window.ips.size > policy.maxDistinctIps) {
      reasons.push(`${window.ips.size} distinct IPs within window (max ${policy.maxDistinctIps})`);
    }
    if (window.requests.length > policy.maxRequestsPerWindow) {
      reasons.push(
        `${window.requests.length} requests within window (max ${policy.maxRequestsPerWindow})`
      );
    }
    if (reasons.length === 0) return null;

    if (this.findOpenIncident(event.keyId, 'usage_anomaly')) return null;

    const incident = this.createIncident(
      record,
      event.keyId,
      'usage_anomaly',
      'high',
      `ip:${event.ip}`,
      `${record.keyPrefix}…`,
      {
        reasons,
        distinctIps: window.ips.size,
        requestsInWindow: window.requests.length,
      }
    );

    this.audit({
      keyId: event.keyId,
      merchantId: record.merchantId,
      action: 'anomaly_flagged',
      actorId: SYSTEM_ACTOR,
      reason: reasons.join('; '),
      incidentId: incident.id,
    });

    if (policy.autoRevokeOnAnomaly) {
      await this.revokeKey(event.keyId, {
        reason: 'usage_anomaly',
        actorId: SYSTEM_ACTOR,
        incidentId: incident.id,
      });
    }
    await this.publishLeakDetected(incident);
    return { ...incident };
  }

  // ── Incident management ──────────────────────────────────────────────────

  /** Confirm a flagged incident and revoke the affected key. */
  async confirmIncident(incidentId: string, actorId: string): Promise<LeakIncident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw AuthError.leakIncidentNotFound(incidentId);
    if (incident.status !== 'open') return { ...incident };

    await this.revokeKey(incident.keyId, { reason: `leak_confirmed:${incident.method}`, actorId });
    return { ...this.incidents.get(incidentId)! };
  }

  /** Mark a flagged incident as a false positive. The key stays active. */
  dismissIncident(incidentId: string, actorId: string, reason: string): LeakIncident {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw AuthError.leakIncidentNotFound(incidentId);
    if (incident.status !== 'open') throw AuthError.leakIncidentClosed(incidentId);

    incident.status = 'dismissed';
    incident.resolvedAt = new Date().toISOString();
    incident.resolvedBy = actorId;
    if (incident.method === 'usage_anomaly') this.usage.delete(incident.keyId);

    this.audit({
      keyId: incident.keyId,
      merchantId: incident.merchantId,
      action: 'incident_dismissed',
      actorId,
      reason,
      incidentId,
    });
    return { ...incident };
  }

  getIncident(incidentId: string): LeakIncident | undefined {
    const incident = this.incidents.get(incidentId);
    return incident ? { ...incident } : undefined;
  }

  getIncidents(
    filter: { merchantId?: string; keyId?: string; status?: LeakIncidentStatus } = {}
  ): LeakIncident[] {
    return Array.from(this.incidents.values())
      .filter((i) => !filter.merchantId || i.merchantId === filter.merchantId)
      .filter((i) => !filter.keyId || i.keyId === filter.keyId)
      .filter((i) => !filter.status || i.status === filter.status)
      .map((i) => ({ ...i }));
  }

  getAuditLog(
    filter: { merchantId?: string; keyId?: string; limit?: number } = {}
  ): ApiKeyRevocationAuditEntry[] {
    return this.auditLog
      .filter((e) => !filter.merchantId || e.merchantId === filter.merchantId)
      .filter((e) => !filter.keyId || e.keyId === filter.keyId)
      .slice(-(filter.limit ?? 100))
      .reverse();
  }

  // ── Policy ───────────────────────────────────────────────────────────────

  getPolicy(merchantId: string): LeakDetectionPolicy {
    return { ...(this.policies.get(merchantId) ?? this.policies.get('default')!) };
  }

  updatePolicy(merchantId: string, patch: Partial<LeakDetectionPolicy>): LeakDetectionPolicy {
    for (const field of ['anomalyWindowMs', 'maxDistinctIps', 'maxRequestsPerWindow'] as const) {
      const value = patch[field];
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        throw new Error(`${field} must be a positive number`);
      }
    }
    for (const field of ['autoRevokeOnExposure', 'autoRevokeOnAnomaly'] as const) {
      const value = patch[field];
      if (value !== undefined && typeof value !== 'boolean') {
        throw new Error(`${field} must be a boolean`);
      }
    }
    const current = this.getPolicy(merchantId);
    const updated: LeakDetectionPolicy = {
      autoRevokeOnExposure: patch.autoRevokeOnExposure ?? current.autoRevokeOnExposure,
      autoRevokeOnAnomaly: patch.autoRevokeOnAnomaly ?? current.autoRevokeOnAnomaly,
      anomalyWindowMs: patch.anomalyWindowMs ?? current.anomalyWindowMs,
      maxDistinctIps: patch.maxDistinctIps ?? current.maxDistinctIps,
      maxRequestsPerWindow: patch.maxRequestsPerWindow ?? current.maxRequestsPerWindow,
    };
    this.policies.set(merchantId, updated);
    logger.info('API key leak detection policy updated', { merchantId, policy: updated });
    return { ...updated };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async handleExposure(
    keyId: string,
    method: LeakDetectionMethod,
    source: string,
    redactedKey: string,
    actorId: string = SYSTEM_ACTOR
  ): Promise<LeakIncident | null> {
    const record = this.keyStore.getKey(keyId);
    // Revoked keys can no longer authenticate — nothing to do.
    if (!record || record.status === 'revoked') return null;

    const existing = this.findOpenIncident(keyId, method);
    if (existing) return { ...existing };

    const incident = this.createIncident(record, keyId, method, 'critical', source, redactedKey, {
      keyStatus: record.status,
    });

    this.audit({
      keyId,
      merchantId: record.merchantId,
      action: 'leak_detected',
      actorId,
      reason: `${method} via ${source}`,
      incidentId: incident.id,
    });
    logger.warn('API key exposure detected', {
      keyId,
      merchantId: record.merchantId,
      method,
      source,
    });

    if (this.getPolicy(record.merchantId).autoRevokeOnExposure) {
      await this.revokeKey(keyId, {
        reason: `leak_detected:${method}`,
        actorId: SYSTEM_ACTOR,
        incidentId: incident.id,
      });
    }
    await this.publishLeakDetected(incident);
    return { ...incident };
  }

  private createIncident(
    record: ApiKeyRecord,
    keyId: string,
    method: LeakDetectionMethod,
    severity: LeakIncidentSeverity,
    source: string,
    redactedKey: string,
    details: Record<string, unknown>
  ): LeakIncident {
    const incident: LeakIncident = {
      id: `leak_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`,
      keyId,
      merchantId: record.merchantId,
      method,
      severity,
      status: 'open',
      source: source || 'unknown',
      redactedKey,
      detectedAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      details,
    };
    this.incidents.set(incident.id, incident);
    return incident;
  }

  private findOpenIncident(keyId: string, method: LeakDetectionMethod): LeakIncident | undefined {
    for (const incident of this.incidents.values()) {
      if (incident.keyId === keyId && incident.method === method && incident.status === 'open')
        return incident;
    }
    return undefined;
  }

  /**
   * Close every open incident for a revoked key. The incident that triggered
   * an automatic revocation (if any) is marked `auto_revoked`.
   */
  private closeIncidentsForKey(
    keyId: string,
    actorId: string,
    autoRevokedIncidentId?: string
  ): void {
    const now = new Date().toISOString();
    for (const incident of this.incidents.values()) {
      if (incident.keyId !== keyId || incident.status !== 'open') continue;
      incident.status = incident.id === autoRevokedIncidentId ? 'auto_revoked' : 'revoked';
      incident.resolvedAt = now;
      incident.resolvedBy = actorId;
    }
  }

  private async publishLeakDetected(incident: LeakIncident): Promise<void> {
    await this.publishSafely(
      buildEvent(
        'auth',
        'api_key_leak_detected',
        {
          incidentId: incident.id,
          keyId: incident.keyId,
          merchantId: incident.merchantId,
          method: incident.method,
          source: incident.source,
          autoRevoked: incident.status === 'auto_revoked',
          detectedAt: Date.parse(incident.detectedAt),
        },
        { aggregateId: incident.merchantId, correlationId: incident.id }
      )
    );
  }

  private async publishSafely(event: Parameters<typeof eventBus.publish>[0]): Promise<void> {
    try {
      await eventBus.publish(event);
    } catch (err) {
      // Revocation must never fail because a downstream subscriber did.
      logger.error('Failed to publish API key revocation event', {
        event: event.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private audit(entry: Omit<ApiKeyRevocationAuditEntry, 'id' | 'timestamp'>): void {
    this.auditLog.push({
      ...entry,
      id: `audit_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
    });
    if (this.auditLog.length > MAX_AUDIT_ENTRIES) this.auditLog.shift();
  }
}

export const apiKeyRevocationService = new ApiKeyRevocationService();
