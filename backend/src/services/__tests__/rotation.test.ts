/**
 * backend/src/services/__tests__/rotation.test.ts
 *
 * Unit tests for the secret rotation service.
 */

import {
  SecretRotationService,
  DEFAULT_POLICY,
  type ProviderName,
  type SecretType,
  type RotationPolicy,
  type SecretMetadata,
  type RotationJob,
  type RotationPhase,
  type SecretStore,
  type SecretGenerator,
  type SecretValidator,
  type SecretPromoter,
  type RotationLogger,
  type RotationMetrics,
  RotationError,
  RotationErrorCode,
} from '../rotation.ts';

// ?? Mock implementations ???????????????????????????????????????????????

const createMockStore = (): SecretStore => {
  const secrets = new Map<string, SecretMetadata>();

  const key = (provider: ProviderName, type: SecretType) => `${provider}:${type}`;

  return {
    getCurrent: async (provider, type) => secrets.get(key(provider, type)) ?? null,
    store: async (metadata) => { secrets.set(key(metadata.provider, metadata.type), metadata); },
    deprecate: async (provider, type, keyId) => {
      const existing = secrets.get(key(provider, type));
      if (existing && existing.keyId === keyId) {
        existing.deprecatedAt = Date.now();
      }
    },
    list: async (provider, type) => {
      const existing = secrets.get(key(provider, type));
      return existing ? [existing] : [];
    },
  };
};

const createMockGenerator = (): SecretGenerator => ({
  generate: async (provider, type) => ({
    keyId: `${provider}_${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    value: `secret_${provider}_${type}_${Date.now()}`,
  }),
});

const createMockValidator = (shouldPass = true): SecretValidator => ({
  validate: async (_provider, _type, _keyId, _value) => shouldPass,
});

const createMockPromoter = (shouldPass = true): SecretPromoter => ({
  promote: async (_provider, _type, _oldKeyId, _newKeyId) => {
    if (!shouldPass) throw new Error('Promotion failed');
  },
});

const createMockLogger = (): RotationLogger => ({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
});

const createMockMetrics = (): RotationMetrics => ({
  increment: () => {},
  gauge: () => {},
  timing: () => {},
});

// ?? Test suite ???????????????????????????????????????????????????????????

describe('SecretRotationService', () => {
  let store: SecretStore;
  let generator: SecretGenerator;
  let validator: SecretValidator;
  let promoter: SecretPromoter;
  let logger: RotationLogger;
  let metrics: RotationMetrics;

  beforeEach(() => {
    store = createMockStore();
    generator = createMockGenerator();
    validator = createMockValidator();
    promoter = createMockPromoter();
    logger = createMockLogger();
    metrics = createMockMetrics();
  });

  const createService = (overrides?: Partial<RotationPolicy>) =>
    new SecretRotationService(store, generator, validator, promoter, {
      logger,
      metrics,
      defaultPolicy: overrides,
    });

  describe('startRotation', () => {
    it('starts a new rotation job', async () => {
      const service = createService({ requireApproval: false });
      const jobId = await service.startRotation('stripe', 'api_key');
      expect(jobId).toMatch(/^rot_stripe_api_key_\d+_[a-z0-9]+$/);

      const job = service.getJob(jobId);
      expect(job).toBeDefined();
      expect(job!.phase).toBe('generating');
      expect(job!.provider).toBe('stripe');
      expect(job!.type).toBe('api_key');
    });

    it('starts a pending job when approval required', async () => {
      const service = createService({ requireApproval: true });
      const jobId = await service.startRotation('paypal', 'webhook_secret');
      const job = service.getJob(jobId);
      expect(job!.phase).toBe('pending');
    });

    it('throws when rotation not due', async () => {
      const service = createService({ rotationIntervalMs: 90 * 24 * 60 * 60 * 1000 });
      // Pre-populate a recent secret
      await store.store({
        provider: 'stripe',
        type: 'api_key',
        keyId: 'existing_key',
        createdAt: Date.now() - 24 * 60 * 60 * 1000, // 1 day ago
        version: 1,
      });

      await expect(service.startRotation('stripe', 'api_key')).rejects.toThrow(
        'Rotation not due yet'
      );
    });

    it('throws when job already running', async () => {
      const service = createService({ requireApproval: false });
      await service.startRotation('stripe', 'api_key');
      await expect(service.startRotation('stripe', 'api_key')).rejects.toThrow(
        'Rotation already in progress'
      );
    });

    it('allows concurrent jobs for different providers', async () => {
      const service = createService({ requireApproval: false });
      const id1 = await service.startRotation('stripe', 'api_key');
      const id2 = await service.startRotation('paypal', 'api_key');
      expect(id1).not.toBe(id2);
      expect(service.getJob(id1)!.phase).toBe('generating');
      expect(service.getJob(id2)!.phase).toBe('generating');
    });
  });

  describe('approveRotation', () => {
    it('approves a pending job', async () => {
      const service = createService({ requireApproval: true });
      const jobId = await service.startRotation('github', 'api_key');
      await service.approveRotation(jobId, 'admin_user');

      const job = service.getJob(jobId);
      expect(job!.phase).toBe('generating');
      expect(job!.approvedBy).toBe('admin_user');
      expect(job!.approvedAt).toBeDefined();
    });

    it('throws for non-existent job', async () => {
      const service = createService({ requireApproval: true });
      await expect(service.approveRotation('nonexistent', 'admin')).rejects.toThrow(
        'Rotation job not found'
      );
    });

    it('throws when job not in pending phase', async () => {
      const service = createService({ requireApproval: false });
      const jobId = await service.startRotation('stripe', 'api_key');
      await expect(service.approveRotation(jobId, 'admin')).rejects.toThrow(
        'Job not in pending phase'
      );
    });
  });

  describe('getJob / listJobs', () => {
    it('returns job by ID', async () => {
      const service = createService();
      const jobId = await service.startRotation('stripe', 'api_key');
      const job = service.getJob(jobId);
      expect(job).toBeDefined();
      expect(job!.id).toBe(jobId);
    });

    it('returns undefined for unknown job', () => {
      const service = createService();
      expect(service.getJob('unknown')).toBeUndefined();
    });

    it('filters jobs by provider', async () => {
      const service = createService({ requireApproval: false });
      await service.startRotation('stripe', 'api_key');
      await service.startRotation('paypal', 'webhook_secret');
      await service.startRotation('stripe', 'webhook_secret');

      const stripeJobs = service.listJobs({ provider: 'stripe' });
      expect(stripeJobs).toHaveLength(2);
      expect(stripeJobs.every(j => j.provider === 'stripe')).toBe(true);
    });

    it('filters jobs by phase', async () => {
      const service = createService({ requireApproval: true });
      await service.startRotation('stripe', 'api_key'); // pending
      await service.startRotation('paypal', 'api_key'); // pending
      const jobId = await service.startRotation('github', 'api_key'); // pending
      await service.approveRotation(jobId, 'admin'); // generating

      const pendingJobs = service.listJobs({ phase: 'pending' });
      expect(pendingJobs).toHaveLength(2);
      const generatingJobs = service.listJobs({ phase: 'generating' });
      expect(generatingJobs).toHaveLength(1);
    });
  });

  describe('processJob (full pipeline)', () => {
    it('completes rotation successfully', async () => {
      const service = createService({
        requireApproval: false,
        gracePeriodMs: 0, // Skip wait for test
      });

      const jobId = await service.startRotation('stripe', 'api_key');

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const job = service.getJob(jobId);
      expect(job!.phase).toBe('completed');
      expect(job!.completedAt).toBeDefined();
      expect(job!.newSecret).toBeDefined();
      expect(job!.newSecret!.keyId).toContain('stripe_api_key');
    });

    it('stores new secret metadata', async () => {
      const service = createService({ requireApproval: false, gracePeriodMs: 0 });
      const jobId = await service.startRotation('stripe', 'api_key');
      await new Promise(resolve => setTimeout(resolve, 100));

      const current = await store.getCurrent('stripe', 'api_key');
      expect(current).not.toBeNull();
      expect(current!.version).toBeGreaterThan(0);
    });

    it('deprecates old secret after grace period', async () => {
      // Pre-populate existing secret
      await store.store({
        provider: 'stripe',
        type: 'api_key',
        keyId: 'old_key',
        createdAt: Date.now() - 86400000,
        version: 1,
      });

      const service = createService({ requireApproval: false, gracePeriodMs: 10 });
      const jobId = await service.startRotation('stripe', 'api_key');
      await new Promise(resolve => setTimeout(resolve, 50));

      const job = service.getJob(jobId);
      expect(job!.phase).toBe('completed');
      const oldSecret = await store.list('stripe', 'api_key');
      const deprecated = oldSecret.find(s => s.keyId === 'old_key');
      expect(deprecated?.deprecatedAt).toBeDefined();
    });

    it('fails validation when validator returns false', async () => {
      const failingValidator = createMockValidator(false);
      const service = new SecretRotationService(
        store, generator, failingValidator, promoter,
        { logger, metrics, defaultPolicy: { requireApproval: false } }
      );

      const jobId = await service.startRotation('stripe', 'api_key');
      await new Promise(resolve => setTimeout(resolve, 100));

      const job = service.getJob(jobId);
      expect(job!.phase).toBe('failed');
      expect(job!.error).toContain('VALIDATION_FAILED');
    });

    it('fails promotion when promoter throws', async () => {
      const failingPromoter = createMockPromoter(false);
      const service = new SecretRotationService(
        store, generator, validator, failingPromoter,
        { logger, metrics, defaultPolicy: { requireApproval: false } }
      );

      const jobId = await service.startRotation('stripe', 'api_key');
      await new Promise(resolve => setTimeout(resolve, 100));

      const job = service.getJob(jobId);
      expect(job!.phase).toBe('failed');
      expect(job!.error).toContain('Promotion failed');
    });

    it('rolls back on promotion failure', async () => {
      const failingPromoter = createMockPromoter(false);
      const service = new SecretRotationService(
        store, generator, validator, failingPromoter,
        { logger, metrics, defaultPolicy: { requireApproval: false } }
      );

      // Pre-populate old secret
      await store.store({
        provider: 'stripe',
        type: 'api_key',
        keyId: 'old_key',
        createdAt: Date.now() - 86400000,
        version: 1,
      });

      const jobId = await service.startRotation('stripe', 'api_key');
      await new Promise(resolve => setTimeout(resolve, 100));

      const job = service.getJob(jobId);
      expect(job!.phase).toBe('rolled_back');
    });
  });

  describe('rotateNow (emergency)', () => {
    it('executes full rotation synchronously', async () => {
      const service = createService();
      const result = await service.rotateNow('stripe', 'api_key');

      expect(result.success).toBe(true);
      expect(result.jobId).toBeDefined();
      expect(result.newKeyId).toBeDefined();
    });

    it('skips approval and grace period', async () => {
      const service = createService({ requireApproval: true, gracePeriodMs: 86400000 });
      const result = await service.rotateNow('stripe', 'api_key', {
        requireApproval: false,
        gracePeriodMs: 0,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('RotationError', () => {
    it('has correct code and properties', () => {
      const error = new RotationError('VALIDATION_FAILED', 'Test error', true, { detail: 'info' });
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.message).toBe('Test error');
      expect(error.retryable).toBe(true);
      expect(error.cause).toEqual({ detail: 'info' });
      expect(error.name).toBe('RotationError');
    });
  });

  describe('DEFAULT_POLICY', () => {
    it('has expected defaults', () => {
      expect(DEFAULT_POLICY.rotationIntervalMs).toBe(90 * 24 * 60 * 60 * 1000);
      expect(DEFAULT_POLICY.maxAgeMs).toBe(120 * 24 * 60 * 60 * 1000);
      expect(DEFAULT_POLICY.gracePeriodMs).toBe(24 * 60 * 60 * 1000);
      expect(DEFAULT_POLICY.requireApproval).toBe(true);
    });
  });

  describe('RotationErrorCode enum', () => {
    it('contains all expected codes', () => {
      const codes: RotationErrorCode[] = [
        'INVALID_PROVIDER',
        'INVALID_SECRET_TYPE',
        'GENERATION_FAILED',
        'VALIDATION_FAILED',
        'PROMOTION_FAILED',
        'DEPRECATION_FAILED',
        'APPROVAL_REQUIRED',
        'APPROVAL_DENIED',
        'ROTATION_WINDOW_CLOSED',
        'JOB_NOT_FOUND',
        'JOB_ALREADY_RUNNING',
        'STORE_ERROR',
      ];
      expect(codes).toHaveLength(12);
    });
  });
});