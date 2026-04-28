import { SandboxIsolationService } from '../services/sandboxIsolationService';
import { ApiKeyService } from '../services/apiKeyService';
import { UsageTrackingService } from '../services/usageTrackingService';
import { SandboxService } from '../services/sandboxService';
import { SandboxMiddleware } from '../middleware/sandboxMiddleware';
import { SandboxUtils } from '../utils/sandboxUtils';

describe('SandboxIsolationService', () => {
  let service: SandboxIsolationService;

  beforeEach(() => {
    service = new SandboxIsolationService();
  });

  describe('createSandboxEnvironment', () => {
    it('should create a sandbox environment with default tier', async () => {
      const env = await service.createSandboxEnvironment('dev-1');

      expect(env).toBeDefined();
      expect(env.id).toBeDefined();
      expect(env.developerId).toBe('dev-1');
      expect(env.status).toBe('active');
      expect(env.config).toBeDefined();
      expect(env.config.rateLimits).toBeDefined();
      expect(env.config.features).toBeDefined();
    });

    it('should create a sandbox environment with pro tier', async () => {
      const env = await service.createSandboxEnvironment('dev-1', 'pro');

      expect(env.config.rateLimits.requestsPerMinute).toBe(120);
      expect(env.config.features.cryptoPayments).toBe(true);
    });

    it('should create a sandbox environment with enterprise tier', async () => {
      const env = await service.createSandboxEnvironment('dev-1', 'enterprise');

      expect(env.config.isolationLevel).toBe('strict');
      expect(env.config.features.gamification).toBe(true);
    });
  });

  describe('getEnvironment', () => {
    it('should return null for non-existent environment', async () => {
      const env = await service.getEnvironment('non-existent');
      expect(env).toBeNull();
    });

    it('should return existing environment', async () => {
      const created = await service.createSandboxEnvironment('dev-1');
      const retrieved = await service.getEnvironment(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });
  });

  describe('updateEnvironment', () => {
    it('should update environment config', async () => {
      const env = await service.createSandboxEnvironment('dev-1');
      const updated = await service.updateEnvironment(env.id, {
        apiVersion: 'v2',
      });

      expect(updated).toBeDefined();
      expect(updated?.config.apiVersion).toBe('v2');
    });

    it('should return null for non-existent environment', async () => {
      const updated = await service.updateEnvironment('non-existent', {
        apiVersion: 'v2',
      });
      expect(updated).toBeNull();
    });
  });

  describe('deleteEnvironment', () => {
    it('should soft delete environment', async () => {
      const env = await service.createSandboxEnvironment('dev-1');
      const result = await service.deleteEnvironment(env.id);

      expect(result).toBe(true);

      const deleted = await service.getEnvironment(env.id);
      expect(deleted?.status).toBe('deleted');
    });

    it('should return false for non-existent environment', async () => {
      const result = await service.deleteEnvironment('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('validateIsolation', () => {
    it('should validate active environment', async () => {
      const env = await service.createSandboxEnvironment('dev-1');
      const validation = await service.validateIsolation(env.id);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should fail validation for deleted environment', async () => {
      const env = await service.createSandboxEnvironment('dev-1');
      await service.deleteEnvironment(env.id);

      const validation = await service.validateIsolation(env.id);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Environment is deleted');
    });
  });

  describe('registerDeveloper', () => {
    it('should register a new developer', async () => {
      const developer = await service.registerDeveloper(
        'test@example.com',
        'Test Developer',
        'Test Company'
      );

      expect(developer).toBeDefined();
      expect(developer.email).toBe('test@example.com');
      expect(developer.name).toBe('Test Developer');
      expect(developer.onboardingStatus.completed).toBe(false);
    });

    it('should not allow duplicate email registration', async () => {
      await service.registerDeveloper('test@example.com', 'Dev 1', 'Company 1');

      await expect(
        service.registerDeveloper('test@example.com', 'Dev 2', 'Company 2')
      ).rejects.toThrow('Developer already registered');
    });
  });

  describe('updateOnboardingStep', () => {
    it('should update onboarding step', async () => {
      const developer = await service.registerDeveloper(
        'test@example.com',
        'Test Dev',
        'Test Co'
      );

      const updated = await service.updateOnboardingStep(
        developer.id,
        'create-sandbox',
        true
      );

      expect(updated).toBeDefined();
      const step = updated?.onboardingStatus.steps.find(
        (s) => s.id === 'create-sandbox'
      );
      expect(step?.completed).toBe(true);
    });
  });
});

describe('ApiKeyService', () => {
  let service: ApiKeyService;

  beforeEach(() => {
    service = new ApiKeyService();
  });

  describe('generateApiKey', () => {
    it('should generate an API key', async () => {
      const key = await service.generateApiKey('env-1', 'Test Key', ['read', 'write']);

      expect(key).toBeDefined();
      expect(key.key).toMatch(/^sk_test_/);
      expect(key.name).toBe('Test Key');
      expect(key.permissions).toEqual(['read', 'write']);
      expect(key.status).toBe('active');
    });

    it('should enforce max keys limit', async () => {
      for (let i = 0; i < 10; i++) {
        await service.generateApiKey('env-1', `Key ${i}`, ['read']);
      }

      await expect(
        service.generateApiKey('env-1', 'Extra Key', ['read'])
      ).rejects.toThrow('Maximum API keys limit reached');
    });
  });

  describe('validateApiKey', () => {
    it('should validate active key', async () => {
      const key = await service.generateApiKey('env-1', 'Test Key', ['read']);
      const validation = await service.validateApiKey(key.key);

      expect(validation.valid).toBe(true);
      expect(validation.apiKey).toBeDefined();
    });

    it('should reject non-existent key', async () => {
      const validation = await service.validateApiKey('sk_test_nonexistent');
      expect(validation.valid).toBe(false);
      expect(validation.error).toBe('API key not found');
    });

    it('should reject revoked key', async () => {
      const key = await service.generateApiKey('env-1', 'Test Key', ['read']);
      await service.revokeApiKey(key.id);

      const validation = await service.validateApiKey(key.key);
      expect(validation.valid).toBe(false);
      expect(validation.error).toBe('API key has been revoked');
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke an API key', async () => {
      const key = await service.generateApiKey('env-1', 'Test Key', ['read']);
      const result = await service.revokeApiKey(key.id);

      expect(result).toBe(true);

      const keys = await service.getApiKeysForEnvironment('env-1');
      const revoked = keys.find((k) => k.id === key.id);
      expect(revoked?.status).toBe('revoked');
    });
  });

  describe('rotateApiKey', () => {
    it('should rotate an API key', async () => {
      const key = await service.generateApiKey('env-1', 'Test Key', ['read']);
      const originalKey = key.key;

      const rotated = await service.rotateApiKey(key.id);

      expect(rotated).toBeDefined();
      expect(rotated?.key).not.toBe(originalKey);
      expect(rotated?.key).toMatch(/^sk_test_/);
    });
  });
});

describe('UsageTrackingService', () => {
  let service: UsageTrackingService;

  beforeEach(() => {
    service = new UsageTrackingService();
  });

  describe('trackRequest', () => {
    it('should track a request', async () => {
      await service.trackRequest('env-1', 'key-1', '/subscriptions', 'GET', 200, 100);

      const metrics = await service.getUsageMetrics('env-1');
      expect(metrics).toBeDefined();
      expect(metrics?.totalRequests).toBe(1);
      expect(metrics?.successfulRequests).toBe(1);
      expect(metrics?.failedRequests).toBe(0);
    });

    it('should track failed requests', async () => {
      await service.trackRequest('env-1', 'key-1', '/subscriptions', 'GET', 500, 100);

      const metrics = await service.getUsageMetrics('env-1');
      expect(metrics?.failedRequests).toBe(1);
    });
  });

  describe('getUsageSummary', () => {
    it('should return usage summary', async () => {
      await service.trackRequest('env-1', 'key-1', '/subscriptions', 'GET', 200, 100);
      await service.trackRequest('env-1', 'key-1', '/payments', 'POST', 201, 150);

      const summary = await service.getUsageSummary('env-1');
      expect(summary).toBeDefined();
      expect(summary?.totalRequests).toBe(2);
      expect(summary?.successRate).toBe(100);
    });
  });

  describe('resetUsage', () => {
    it('should reset usage data', async () => {
      await service.trackRequest('env-1', 'key-1', '/subscriptions', 'GET', 200, 100);

      const result = await service.resetUsage('env-1');
      expect(result).toBe(true);

      const metrics = await service.getUsageMetrics('env-1');
      expect(metrics).toBeNull();
    });
  });
});

describe('SandboxUtils', () => {
  describe('generateNamespace', () => {
    it('should generate a namespace', () => {
      const namespace = SandboxUtils.generateNamespace('env-123');
      expect(namespace).toBe('sandbox_env_123');
    });
  });

  describe('validateEnvironmentStatus', () => {
    it('should validate active environment', () => {
      const env = {
        id: '1',
        developerId: 'dev-1',
        name: 'Test',
        status: 'active' as const,
        config: {} as any,
        apiKeys: [],
        testData: {} as any,
        usage: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = SandboxUtils.validateEnvironmentStatus(env);
      expect(result.valid).toBe(true);
    });

    it('should reject deleted environment', () => {
      const env = {
        id: '1',
        developerId: 'dev-1',
        name: 'Test',
        status: 'deleted' as const,
        config: {} as any,
        apiKeys: [],
        testData: {} as any,
        usage: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = SandboxUtils.validateEnvironmentStatus(env);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Environment has been deleted');
    });
  });

  describe('checkResourceLimits', () => {
    it('should pass when within limits', () => {
      const limits = {
        maxRequestsPerMinute: 60,
        maxRequestsPerDay: 10000,
        maxStorageMB: 100,
        maxConcurrentConnections: 10,
        maxSubscriptions: 50,
        maxWebhooks: 5,
      };

      const usage = {
        requestsPerMinute: 30,
        requestsPerDay: 5000,
        storageMB: 50,
        connections: 5,
      };

      const result = SandboxUtils.checkResourceLimits(limits, usage);
      expect(result.withinLimits).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should fail when exceeding limits', () => {
      const limits = {
        maxRequestsPerMinute: 60,
        maxRequestsPerDay: 10000,
        maxStorageMB: 100,
        maxConcurrentConnections: 10,
        maxSubscriptions: 50,
        maxWebhooks: 5,
      };

      const usage = {
        requestsPerMinute: 100,
        requestsPerDay: 15000,
        storageMB: 150,
        connections: 15,
      };

      const result = SandboxUtils.checkResourceLimits(limits, usage);
      expect(result.withinLimits).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  describe('sanitizeForSandbox', () => {
    it('should sanitize strings', () => {
      const result = SandboxUtils.sanitizeForSandbox('<script>alert("xss")</script>');
      expect(result).toBe('scriptalert("xss")/script');
    });

    it('should sanitize nested objects', () => {
      const data = {
        name: '<b>Test</b>',
        nested: {
          value: '<i>Inner</i>',
        },
      };

      const result = SandboxUtils.sanitizeForSandbox(data) as any;
      expect(result.name).toBe('bTest/b');
      expect(result.nested.value).toBe('iInner/i');
    });
  });
});
