/**
 * backend/src/services/rotation.ts
 *
 * Provider secret rotation service with automated key swap.
 *
 * Implements a zero-downtime secret rotation workflow for external provider
 * credentials (Stripe, PayPal, GitHub, etc.). The service orchestrates the
 * full lifecycle: generate new secret → validate → promote → deprecate old.
 *
 * Issue #2275.
 */

// Use noop logger to avoid external dependency
const defaultLogger: RotationLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ?? Public types ?????????????????????????????????????????????????????????????

export type ProviderName =
  | 'stripe'
  | 'paypal'
  | 'github'
  | 'openai'
  | 'anthropic'
  | 'slack'
  | 'sendgrid'
  | 'twilio'
  | 'aws'
  | 'gcp'
  | 'azure'
  | string; // extensible

export type SecretType =
  | 'api_key'
  | 'webhook_secret'
  | 'client_secret'
  | 'private_key'
  | 'certificate'
  | 'oauth_token'
  | string; // extensible

export type RotationPhase =
  | 'pending'
  | 'generating'
  | 'validating'
  | 'promoting'
  | 'deprecating'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export interface SecretMetadata {
  provider: ProviderName;
  type: SecretType;
  keyId: string; // provider's key identifier
  createdAt: number;
  expiresAt?: number;
  rotatedAt?: number;
  deprecatedAt?: number;
  version: number;
}

export interface RotationPolicy {
  /** How often to rotate (milliseconds). 0 = manual only. */
  rotationIntervalMs: number;
  /** Max age before forced rotation (milliseconds). */
  maxAgeMs: number;
  /** Grace period after promotion before deprecating old (milliseconds). */
  gracePeriodMs: number;
  /** Require manual approval before promotion. */
  requireApproval: boolean;
  /** Allowed rotation window (cron expression, empty = anytime). */
  rotationWindow?: string;
}

export interface RotationJob {
  id: string;
  provider: ProviderName;
  type: SecretType;
  policy: RotationPolicy;
  phase: RotationPhase;
  currentSecret?: SecretMetadata;
  newSecret?: SecretMetadata;
  error?: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  approvedBy?: string;
  approvedAt?: number;
}

export interface RotationResult {
  success: boolean;
  jobId: string;
  newKeyId?: string;
  oldKeyId?: string;
  error?: string;
}

export interface SecretStore {
  /** Retrieve current secret metadata. */
  getCurrent(provider: ProviderName, type: SecretType): Promise<SecretMetadata | null>;
  /** Store new secret metadata (not the secret value itself). */
  store(metadata: SecretMetadata): Promise<void>;
  /** Mark secret as deprecated. */
  deprecate(provider: ProviderName, type: SecretType, keyId: string): Promise<void>;
  /** List all secrets for a provider/type. */
  list(provider: ProviderName, type: SecretType): Promise<SecretMetadata[]>;
}

export interface SecretGenerator {
  /** Generate a new secret value and provider-specific key ID. */
  generate(provider: ProviderName, type: SecretType): Promise<{ keyId: string; value: string }>;
}

export interface SecretValidator {
  /** Validate that a secret works with the provider. */
  validate(provider: ProviderName, type: SecretType, keyId: string, value: string): Promise<boolean>;
}

export interface SecretPromoter {
  /** Promote new secret to active (update provider config, webhook endpoints, etc.). */
  promote(provider: ProviderName, type: SecretType, oldKeyId: string, newKeyId: string): Promise<void>;
}

export interface RotationLogger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface RotationMetrics {
  increment?(name: string, value?: number, tags?: Record<string, string>): void;
  gauge?(name: string, value: number, tags?: Record<string, string>): void;
  timing?(name: string, milliseconds: number, tags?: Record<string, string>): void;
}

export type RotationErrorCode =
  | 'INVALID_PROVIDER'
  | 'INVALID_SECRET_TYPE'
  | 'GENERATION_FAILED'
  | 'VALIDATION_FAILED'
  | 'PROMOTION_FAILED'
  | 'DEPRECATION_FAILED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_DENIED'
  | 'ROTATION_WINDOW_CLOSED'
  | 'JOB_NOT_FOUND'
  | 'JOB_ALREADY_RUNNING'
  | 'STORE_ERROR';

export class RotationError extends Error {
  readonly code: RotationErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(
    code: RotationErrorCode,
    message: string,
    retryable = false,
    cause?: unknown
  ) {
    super(message);
    this.name = 'RotationError';
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
  }
}

// ?? Constants ?????????????????????????????????????????????????????????????

const METRIC_PREFIX = 'subtrackr.rotation';
export const DEFAULT_POLICY: RotationPolicy = {
  rotationIntervalMs: 90 * 24 * 60 * 60 * 1000, // 90 days
  maxAgeMs: 120 * 24 * 60 * 60 * 1000, // 120 days
  gracePeriodMs: 24 * 60 * 60 * 1000, // 24 hours
  requireApproval: true,
};

const NOOP_LOGGER: RotationLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const NOOP_METRICS: RotationMetrics = {
  increment: () => {},
  gauge: () => {},
  timing: () => {},
};

// ?? Core Service ????????????????????????????????????????????????????????????

export class SecretRotationService {
  private readonly jobs = new Map<string, RotationJob>();
  private readonly logger: RotationLogger;
  private readonly metrics: RotationMetrics;
  private readonly store: SecretStore;
  private readonly generator: SecretGenerator;
  private readonly validator: SecretValidator;
  private readonly promoter: SecretPromoter;

  constructor(
    store: SecretStore,
    generator: SecretGenerator,
    validator: SecretValidator,
    promoter: SecretPromoter,
    options: {
      logger?: RotationLogger;
      metrics?: RotationMetrics;
      defaultPolicy?: Partial<RotationPolicy>;
    } = {}
  ) {
    this.store = store;
    this.generator = generator;
    this.validator = validator;
    this.promoter = promoter;
    this.logger = options.logger ?? defaultLogger as RotationLogger;
    this.metrics = options.metrics ?? NOOP_METRICS;
  }

  /**
   * Start a new rotation job. Returns the job ID.
   * If approval is required, the job stays in 'pending' until approved.
   */
  async startRotation(
    provider: ProviderName,
    type: SecretType,
    policy: Partial<RotationPolicy> = {},
    requester?: string
  ): Promise<string> {
    const mergedPolicy = { ...DEFAULT_POLICY, ...policy };

    // Check if rotation is due
    const current = await this.store.getCurrent(provider, type);
    if (current && !this.isRotationDue(current, mergedPolicy)) {
      this.logger.info('Rotation not due', { provider, type, keyId: current.keyId });
      throw new RotationError('ROTATION_WINDOW_CLOSED', 'Rotation not due yet');
    }

    // Check for existing running job
    for (const job of this.jobs.values()) {
      if (
        job.provider === provider &&
        job.type === type &&
        !['completed', 'failed', 'rolled_back'].includes(job.phase)
      ) {
        throw new RotationError('JOB_ALREADY_RUNNING', 'Rotation already in progress');
      }
    }

    const jobId = `rot_${provider}_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const job: RotationJob = {
      id: jobId,
      provider,
      type,
      policy: mergedPolicy,
      phase: mergedPolicy.requireApproval ? 'pending' : 'generating',
      currentSecret: current ?? undefined,
      startedAt: now,
      updatedAt: now,
    };

    this.jobs.set(jobId, job);
    this.logger.info('Rotation job started', { jobId, provider, type, phase: job.phase });
    this.metrics.increment(`${METRIC_PREFIX}.jobs.started`, 1, { provider, type });

    if (!mergedPolicy.requireApproval) {
      this.processJob(jobId).catch((err) => {
        this.logger.error('Rotation job failed', { jobId, error: err.message });
      });
    }

    return jobId;
  }

  /**
   * Approve a pending rotation job.
   */
  async approveRotation(jobId: string, approver: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new RotationError('JOB_NOT_FOUND', 'Rotation job not found');
    }
    if (job.phase !== 'pending') {
      throw new RotationError('APPROVAL_DENIED', `Job not in pending phase (current: ${job.phase})`);
    }

    job.phase = 'generating';
    job.approvedBy = approver;
    job.approvedAt = Date.now();
    job.updatedAt = Date.now();

    this.logger.info('Rotation approved', { jobId, approver });
    this.metrics.increment(`${METRIC_PREFIX}.approved`, 1, { provider: job.provider, type: job.type });

    this.processJob(jobId).catch((err) => {
      this.logger.error('Rotation job failed after approval', { jobId, error: err.message });
    });
  }

  /**
   * Get job status.
   */
  getJob(jobId: string): RotationJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * List all jobs, optionally filtered.
   */
  listJobs(filter?: { provider?: ProviderName; type?: SecretType; phase?: RotationPhase }): RotationJob[] {
    return Array.from(this.jobs.values()).filter((job) => {
      if (filter?.provider && job.provider !== filter.provider) return false;
      if (filter?.type && job.type !== filter.type) return false;
      if (filter?.phase && job.phase !== filter.phase) return false;
      return true;
    });
  }

  /**
   * Check if rotation is due based on policy.
   */
  private isRotationDue(current: SecretMetadata, policy: RotationPolicy): boolean {
    if (policy.rotationIntervalMs === 0) return false; // manual only
    const age = Date.now() - current.createdAt;
    if (age >= policy.maxAgeMs) return true; // forced rotation
    if (age >= policy.rotationIntervalMs) return true; // scheduled rotation
    return false;
  }

  /**
   * Main job processing pipeline.
   */
  private async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const { provider, type, policy } = job;
    const startTime = Date.now();

    try {
      // Phase 1: Generate new secret
      job.phase = 'generating';
      job.updatedAt = Date.now();
      this.logger.info('Generating new secret', { jobId, provider, type });

      const { keyId: newKeyId, value: newValue } = await this.generator.generate(provider, type);

      job.newSecret = {
        provider,
        type,
        keyId: newKeyId,
        createdAt: Date.now(),
        version: (job.currentSecret?.version ?? 0) + 1,
      };

      // Phase 2: Validate new secret
      job.phase = 'validating';
      job.updatedAt = Date.now();
      this.logger.info('Validating new secret', { jobId, newKeyId });

      const valid = await this.validator.validate(provider, type, newKeyId, newValue);
      if (!valid) {
        throw new RotationError('VALIDATION_FAILED', 'New secret failed validation', true);
      }

      // Phase 3: Promote new secret
      job.phase = 'promoting';
      job.updatedAt = Date.now();
      this.logger.info('Promoting new secret', { jobId, newKeyId });

      const oldKeyId = job.currentSecret?.keyId;
      if (oldKeyId) {
        await this.promoter.promote(provider, type, oldKeyId, newKeyId);
      }

      // Phase 4: Store new secret metadata
      await this.store.store(job.newSecret);

      // Phase 5: Deprecate old secret after grace period
      job.phase = 'deprecating';
      job.updatedAt = Date.now();

      if (oldKeyId) {
        // Wait for grace period
        await this.sleep(policy.gracePeriodMs);
        await this.store.deprecate(provider, type, oldKeyId);
        job.currentSecret!.deprecatedAt = Date.now();
      }

      // Complete
      job.phase = 'completed';
      job.completedAt = Date.now();
      job.updatedAt = Date.now();

      this.logger.info('Rotation completed', {
        jobId,
        provider,
        type,
        oldKeyId,
        newKeyId,
        durationMs: Date.now() - startTime,
      });

      this.metrics.increment(`${METRIC_PREFIX}.completed`, 1, { provider, type });
      this.metrics.timing(`${METRIC_PREFIX}.duration`, Date.now() - startTime, { provider, type });

    } catch (error) {
      job.phase = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.updatedAt = Date.now();

      this.logger.error('Rotation failed', { jobId, error: job.error });

      this.metrics.increment(`${METRIC_PREFIX}.failed`, 1, {
        provider,
        type,
        code: error instanceof RotationError ? error.code : 'UNKNOWN',
      });

      // Attempt rollback if we got past validation
      if (['promoting', 'deprecating', 'completed'].includes(job.phase)) {
        await this.rollback(job);
      }
    }
  }

  /**
   * Rollback a failed rotation.
   */
  private async rollback(job: RotationJob): Promise<void> {
    job.phase = 'rolled_back';
    job.updatedAt = Date.now();

    this.logger.warn('Rolling back rotation', { jobId: job.id });

    try {
      // If we promoted a new key, revert to old
      if (job.newSecret && job.currentSecret) {
        await this.promoter.promote(job.provider, job.type, job.newSecret.keyId, job.currentSecret.keyId);
      }
      // Remove new secret metadata if stored
      if (job.newSecret) {
        // Note: store doesn't have delete, but we could add it
      }

      this.metrics.increment(`${METRIC_PREFIX}.rolled_back`, 1, {
        provider: job.provider,
        type: job.type,
      });
    } catch (rollbackError) {
      this.logger.error('Rollback failed', {
        jobId: job.id,
        error: rollbackError instanceof Error ? rollbackError.message : 'Unknown',
      });
      this.metrics.increment(`${METRIC_PREFIX}.rollback_failed`, 1, {
        provider: job.provider,
        type: job.type,
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute a full rotation synchronously (for manual/emergency use).
   * Skips approval and grace period wait.
   */
  async rotateNow(
    provider: ProviderName,
    type: SecretType,
    policy: Partial<RotationPolicy> = {}
  ): Promise<RotationResult> {
    const jobId = await this.startRotation(provider, type, {
      ...policy,
      requireApproval: false,
      gracePeriodMs: 0,
    });

    const job = this.jobs.get(jobId)!;
    await this.processJob(jobId);

    return {
      success: job.phase === 'completed',
      jobId,
      newKeyId: job.newSecret?.keyId,
      oldKeyId: job.currentSecret?.keyId,
      error: job.error,
    };
  }
}

// ?? Factory for common provider integrations ?????????????????????????????????

export interface ProviderIntegration {
  name: ProviderName;
  store: SecretStore;
  generator: SecretGenerator;
  validator: SecretValidator;
  promoter: SecretPromoter;
}

export function createRotationService(
  integrations: ProviderIntegration[],
  options?: { logger?: RotationLogger; metrics?: RotationMetrics }
): SecretRotationService {
  // For simplicity, we use the first integration as default
  // In production, you'd route by provider
  const primary = integrations[0];
  return new SecretRotationService(
    primary.store,
    primary.generator,
    primary.validator,
    primary.promoter,
    options
  );
}