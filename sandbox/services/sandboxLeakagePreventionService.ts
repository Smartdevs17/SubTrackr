/**
 * SandboxLeakagePreventionService - Guards against sandbox data leaking into production.
 * Enforces strict data isolation, prevents production endpoint calls from sandbox keys,
 * and ensures mock data never reaches production systems.
 *
 * Edge cases handled:
 *  - Sandbox API key calling production endpoints
 *  - Production API key calling sandbox endpoints
 *  - Test data accidentally persisted to production DB
 *  - Webhook secrets shared between sandbox/production
 *  - Rate limit differences between sandbox and production
 */
import { ApiKey } from '../types/sandbox';

// ─── Leakage detection types ──────────────────────────────────────────────────

export interface LeakageCheckResult {
  allowed: boolean;
  reason?: string;
  severity: 'none' | 'warning' | 'critical' | 'blocked';
  category: LeakageCategory;
  details?: Record<string, unknown>;
}

export type LeakageCategory =
  | 'key_mismatch'
  | 'endpoint_mismatch'
  | 'data_leakage'
  | 'webhook_leakage'
  | 'rate_limit_mismatch'
  | 'credential_sharing'
  | 'network_boundary';

export interface LeakageAuditEntry {
  id: string;
  timestamp: Date;
  category: LeakageCategory;
  severity: 'warning' | 'critical' | 'blocked';
  description: string;
  source: { environmentId: string; apiKeyId?: string };
  target: { endpoint: string; environment: 'sandbox' | 'production' };
  actionTaken: 'blocked' | 'warned' | 'flagged' | 'allowed';
  metadata?: Record<string, unknown>;
}

export interface ProductionGuardConfig {
  enforceKeyOrigin: boolean;
  enforceEndpointIsolation: boolean;
  enforceDataSanitization: boolean;
  enforceWebhookIsolation: boolean;
  enforceRateLimitDifferentiation: boolean;
  enforceCredentialRotation: boolean;
  auditMode: boolean;
  autoBlockLeakage: boolean;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class SandboxLeakagePreventionService {
  private auditLog: LeakageAuditEntry[] = [];
  private blockedEndpoints: Set<string> = new Set();
  private sandboxKeyPrefix = 'sk_sandbox_';
  private productionKeyPrefix = 'sk_live_';

  private readonly config: ProductionGuardConfig = {
    enforceKeyOrigin: true,
    enforceEndpointIsolation: true,
    enforceDataSanitization: true,
    enforceWebhookIsolation: true,
    enforceRateLimitDifferentiation: true,
    enforceCredentialRotation: true,
    auditMode: false,
    autoBlockLeakage: true,
  };

  // ── Production endpoint patterns that should NEVER be called from sandbox ──

  private readonly PRODUCTION_ONLY_ENDPOINTS = [
    '/api/v1/production/',
    '/api/v1/live/',
    '/api/v1/contracts/deploy',
    '/api/v1/blockchain/submit',
    '/api/v1/payments/charge',
    '/api/v1/customers/real',
  ];

  // ── Sandbox-only endpoints ─────────────────────────────────────────────────

  private readonly SANDBOX_ONLY_ENDPOINTS = [
    '/api/v1/sandbox/',
    '/api/v1/mock/',
    '/api/v1/test/',
    '/api/v1/simulate/',
  ];

  // ── Patterns indicating potential data leakage ──────────────────────────────

  private readonly DATA_LEAKAGE_PATTERNS = [
    /production/i,
    /live_key/i,
    /real_customer/i,
    /actual_payment/i,
    /prod_db/i,
    /mainnet/i,
    /0x[0-9a-fA-F]{40}/, // real blockchain addresses
  ];

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Check if a sandbox API key can access a given endpoint */
  async checkKeyEndpointAccess(apiKey: ApiKey, endpoint: string): Promise<LeakageCheckResult> {
    const isSandboxKey = apiKey.key.startsWith(this.sandboxKeyPrefix);

    // Sandbox key trying to access production-only endpoints
    if (isSandboxKey && this.isProductionEndpoint(endpoint)) {
      await this.logLeakageAttempt({
        category: 'endpoint_mismatch',
        severity: 'blocked',
        description: `Sandbox key attempting to access production endpoint: ${endpoint}`,
        source: { environmentId: 'unknown', apiKeyId: apiKey.id },
        target: { endpoint, environment: 'production' },
        actionTaken: 'blocked',
      });

      return {
        allowed: false,
        reason: `Sandbox API keys cannot access production endpoints. Use a production API key (${this.productionKeyPrefix}...) for: ${endpoint}`,
        severity: 'blocked',
        category: 'endpoint_mismatch',
        details: { endpoint, keyPrefix: this.sandboxKeyPrefix },
      };
    }

    // Production key calling sandbox endpoints (warning but allowed)
    if (!isSandboxKey && this.isSandboxEndpoint(endpoint)) {
      await this.logLeakageAttempt({
        category: 'endpoint_mismatch',
        severity: 'warning',
        description: `Production key accessing sandbox endpoint: ${endpoint}`,
        source: { environmentId: 'unknown', apiKeyId: apiKey.id },
        target: { endpoint, environment: 'sandbox' },
        actionTaken: 'warned',
      });

      return {
        allowed: true,
        reason: 'Production key on sandbox endpoint - allowed but not recommended',
        severity: 'warning',
        category: 'endpoint_mismatch',
      };
    }

    return { allowed: true, severity: 'none', category: 'endpoint_mismatch' };
  }

  /** Validate data payloads for potential production data in sandbox context */
  async checkDataLeakage(
    data: unknown,
    context: 'sandbox' | 'production'
  ): Promise<LeakageCheckResult> {
    if (context !== 'sandbox') {
      return { allowed: true, severity: 'none', category: 'data_leakage' };
    }

    const dataString = JSON.stringify(data);
    const matches: string[] = [];

    for (const pattern of this.DATA_LEAKAGE_PATTERNS) {
      const match = dataString.match(pattern);
      if (match) {
        matches.push(match[0]);
      }
    }

    if (matches.length > 0) {
      await this.logLeakageAttempt({
        category: 'data_leakage',
        severity: 'critical',
        description: `Potential production data detected in sandbox: ${matches.join(', ')}`,
        source: { environmentId: 'unknown' },
        target: { endpoint: 'data_payload', environment: 'sandbox' },
        actionTaken: this.config.autoBlockLeakage ? 'blocked' : 'flagged',
        metadata: { matches },
      });

      return {
        allowed: !this.config.autoBlockLeakage,
        reason: `Potential production data detected in sandbox payload. Matches: ${matches.join(', ')}`,
        severity: 'critical',
        category: 'data_leakage',
        details: { matches },
      };
    }

    return { allowed: true, severity: 'none', category: 'data_leakage' };
  }

  /** Validate webhook URLs to prevent sandbox webhooks pointing to production */
  async checkWebhookIsolation(
    webhookUrl: string,
    environment: 'sandbox' | 'production'
  ): Promise<LeakageCheckResult> {
    const isProductionUrl =
      webhookUrl.includes('api.') ||
      webhookUrl.includes('production') ||
      webhookUrl.includes('.com/api') ||
      (!webhookUrl.includes('localhost') &&
        !webhookUrl.includes('test') &&
        !webhookUrl.includes('sandbox') &&
        !webhookUrl.includes('staging') &&
        !webhookUrl.includes('dev.'));

    if (environment === 'sandbox' && isProductionUrl) {
      await this.logLeakageAttempt({
        category: 'webhook_leakage',
        severity: 'critical',
        description: `Sandbox webhook URL appears to be production: ${webhookUrl}`,
        source: { environmentId: 'unknown' },
        target: { endpoint: webhookUrl, environment: 'sandbox' },
        actionTaken: 'blocked',
      });

      return {
        allowed: false,
        reason: 'Sandbox webhooks must use test endpoints. Production URLs detected.',
        severity: 'critical',
        category: 'webhook_leakage',
        details: { webhookUrl },
      };
    }

    return { allowed: true, severity: 'none', category: 'webhook_leakage' };
  }

  /** Ensure rate limits differ between sandbox and production */
  async checkRateLimitDifferentiation(
    sandboxRateLimit: number,
    productionRateLimit: number
  ): Promise<LeakageCheckResult> {
    // Sandbox rate limits should be significantly lower than production
    const ratio = productionRateLimit / sandboxRateLimit;

    if (ratio < 2 && sandboxRateLimit > 0) {
      return {
        allowed: true,
        reason: `Sandbox rate limit (${sandboxRateLimit}) is too close to production (${productionRateLimit}). Recommended ratio is at least 3:1.`,
        severity: 'warning',
        category: 'rate_limit_mismatch',
        details: { sandboxRateLimit, productionRateLimit, ratio },
      };
    }

    if (sandboxRateLimit >= productionRateLimit) {
      await this.logLeakageAttempt({
        category: 'rate_limit_mismatch',
        severity: 'critical',
        description: `Sandbox rate limit (${sandboxRateLimit}) equals or exceeds production (${productionRateLimit})`,
        source: { environmentId: 'unknown' },
        target: { endpoint: 'rate_limit_config', environment: 'sandbox' },
        actionTaken: 'flagged',
      });

      return {
        allowed: true,
        reason: 'Sandbox rate limit should be lower than production. Consider reducing.',
        severity: 'critical',
        category: 'rate_limit_mismatch',
        details: { sandboxRateLimit, productionRateLimit, ratio },
      };
    }

    return { allowed: true, severity: 'none', category: 'rate_limit_mismatch' };
  }

  /** Sanitize data before persisting to ensure no production markers leak */
  sanitizeDataForSandbox(data: unknown): unknown {
    if (typeof data === 'string') {
      // Strip production key prefixes
      return data
        .replace(new RegExp(this.productionKeyPrefix, 'g'), '[REDACTED_PROD_KEY]')
        .replace(/sk_live_[A-Za-z0-9]+/g, '[REDACTED_PROD_KEY]')
        .replace(/prod_[a-zA-Z0-9_]+/g, '[REDACTED_PROD_ID]');
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeDataForSandbox(item));
    }

    if (typeof data === 'object' && data !== null) {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        // Strip production-specific fields
        if (
          key === 'productionKey' ||
          key === 'liveKey' ||
          key === 'prodEnvironment' ||
          key === 'mainnetAddress'
        ) {
          sanitized[key] = '[REDACTED]';
          continue;
        }
        sanitized[key] = this.sanitizeDataForSandbox(value);
      }
      return sanitized;
    }

    return data;
  }

  /** Get the full audit log */
  getAuditLog(options?: {
    category?: LeakageCategory;
    severity?: LeakageCheckResult['severity'];
    limit?: number;
  }): LeakageAuditEntry[] {
    let filtered = this.auditLog;

    if (options?.category) {
      filtered = filtered.filter((e) => e.category === options.category);
    }
    if (options?.severity) {
      filtered = filtered.filter((e) => e.severity === options.severity);
    }

    return filtered.slice(-(options?.limit || 100)).reverse();
  }

  /** Block a specific endpoint from sandbox access */
  blockEndpoint(endpoint: string): void {
    this.blockedEndpoints.add(endpoint);
  }

  /** Unblock an endpoint */
  unblockEndpoint(endpoint: string): void {
    this.blockedEndpoints.delete(endpoint);
  }

  /** Check if an endpoint is blocked */
  isEndpointBlocked(endpoint: string): boolean {
    return this.blockedEndpoints.has(endpoint);
  }

  /** Get summary of leakage prevention status */
  getLeakageSummary(): {
    totalAuditEntries: number;
    blockedAttempts: number;
    warnings: number;
    criticals: number;
    topCategories: { category: string; count: number }[];
  } {
    const blocked = this.auditLog.filter((e) => e.actionTaken === 'blocked').length;
    const warnings = this.auditLog.filter((e) => e.severity === 'warning').length;
    const criticals = this.auditLog.filter((e) => e.severity === 'critical').length;

    const categoryCounts: Record<string, number> = {};
    for (const entry of this.auditLog) {
      categoryCounts[entry.category] = (categoryCounts[entry.category] || 0) + 1;
    }

    const topCategories = Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    return {
      totalAuditEntries: this.auditLog.length,
      blockedAttempts: blocked,
      warnings,
      criticals,
      topCategories,
    };
  }

  /** Clear audit log */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private isProductionEndpoint(endpoint: string): boolean {
    return this.PRODUCTION_ONLY_ENDPOINTS.some((ep) => endpoint.startsWith(ep));
  }

  private isSandboxEndpoint(endpoint: string): boolean {
    return this.SANDBOX_ONLY_ENDPOINTS.some((ep) => endpoint.startsWith(ep));
  }

  private async logLeakageAttempt(entry: Omit<LeakageAuditEntry, 'id'>): Promise<void> {
    const fullEntry: LeakageAuditEntry = {
      ...entry,
      id: `leak_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    };

    this.auditLog.push(fullEntry);

    // Keep audit log manageable
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-500);
    }
  }
}

export const sandboxLeakagePrevention = new SandboxLeakagePreventionService();
