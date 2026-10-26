import { DataExportService, type UserDataCollector } from '../dataExportService';
import { DataDeletionService, type DataDeleter } from '../dataDeletionService';
import { GdprController } from '../gdprController';
import { PII_REGISTRY, getFieldDefinition } from '../piiRegistry';

describe('GDPR Data Export Service', () => {
  let service: DataExportService;

  beforeEach(() => {
    service = new DataExportService();
  });

  it('should register and list data collectors', () => {
    const collector: UserDataCollector = {
      sourceName: 'subscriptions',
      collect: async () => [],
    };
    service.registerCollector(collector);
    expect(service.listSources()).toContain('subscriptions');
  });

  it('should export user data at full level (no anonymization)', async () => {
    const collector: UserDataCollector = {
      sourceName: 'subscriptions',
      collect: async (userId) => [
        { id: 'sub-1', userId, email: 'test@example.com', planId: 'pro', amount: 9.99 },
      ],
    };
    service.registerCollector(collector);

    const result = await service.exportUserData({
      userId: 'user-123',
      exportLevel: 'full',
      requestedAt: Date.now(),
      requestId: 'req-1',
    });

    expect(result.recordCount).toBe(1);
    expect(result.data[0].email).toBe('test@example.com');
    expect(result.data[0].userId).toBe('user-123');
    expect(result.sources).toContain('subscriptions');
    expect(result.checksum).toBeDefined();
  });

  it('should anonymize direct identifiers at pseudonymized level', async () => {
    const collector: UserDataCollector = {
      sourceName: 'users',
      collect: async () => [
        { email: 'test@example.com', name: 'John Doe', country: 'US' },
      ],
    };
    service.registerCollector(collector);

    const result = await service.exportUserData({
      userId: 'user-123',
      exportLevel: 'pseudonymized',
      requestedAt: Date.now(),
      requestId: 'req-2',
    });

    expect(result.data[0].email).not.toBe('test@example.com');
    expect(result.data[0].email).toContain('*');
    expect(result.data[0].name).not.toBe('John Doe');
    // Quasi-identifiers should remain
    expect(result.data[0].country).toBe('US');
  });

  it('should anonymize all PII at anonymized level', async () => {
    const collector: UserDataCollector = {
      sourceName: 'users',
      collect: async () => [
        { email: 'test@example.com', name: 'John', country: 'US', amount: 10 },
      ],
    };
    service.registerCollector(collector);

    const result = await service.exportUserData({
      userId: 'user-123',
      exportLevel: 'anonymized',
      requestedAt: Date.now(),
      requestId: 'req-3',
    });

    expect(result.data[0].email).not.toBe('test@example.com');
    expect(result.data[0].name).not.toBe('John');
  });

  it('should handle empty data gracefully', async () => {
    const collector: UserDataCollector = {
      sourceName: 'empty',
      collect: async () => [],
    };
    service.registerCollector(collector);

    const result = await service.exportUserData({
      userId: 'user-123',
      exportLevel: 'full',
      requestedAt: Date.now(),
      requestId: 'req-4',
    });

    expect(result.recordCount).toBe(0);
    expect(result.data).toEqual([]);
  });
});

describe('GDPR Data Deletion Service', () => {
  let service: DataDeletionService;
  let mockDeleter: DataDeleter;

  beforeEach(() => {
    service = new DataDeletionService(0); // 0 day grace period for testing
    mockDeleter = {
      sourceName: 'subscriptions',
      deleteUserData: async (userId) => ({ source: 'subscriptions', deletedCount: 5 }),
    };
    service.registerDeleter(mockDeleter);
  });

  it('should create a deletion request with grace period', () => {
    const req = service.createDeletionRequest('user-123');
    expect(req.status).toBe('grace_period');
    expect(req.userId).toBe('user-123');
    expect(req.verificationToken).toBeDefined();
    expect(req.gracePeriodEndsAt).toBeGreaterThan(req.requestedAt);
  });

  it('should detect active deletion requests', () => {
    service.createDeletionRequest('user-123');
    expect(service.hasActiveDeletionRequest('user-123')).toBe(true);
    expect(service.hasActiveDeletionRequest('user-456')).toBe(false);
  });

  it('should cancel a deletion request during grace period', () => {
    const req = service.createDeletionRequest('user-123');
    const result = service.cancelDeletionRequest(req.id, 'user-123');
    expect(result.success).toBe(true);
    expect(result.request?.status).toBe('cancelled');
  });

  it('should not allow cancellation by a different user', () => {
    const req = service.createDeletionRequest('user-123');
    const result = service.cancelDeletionRequest(req.id, 'user-456');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('should execute deletion after grace period', async () => {
    const req = service.createDeletionRequest('user-123');
    const result = await service.executeDeletion(req.id);
    expect(result.success).toBe(true);
    expect(result.request?.status).toBe('completed');
    expect(result.request?.deletionResults).toHaveLength(1);
    expect(result.request?.deletionResults?.[0].deletedCount).toBe(5);
  });

  it('should not execute deletion during grace period', async () => {
    const graceService = new DataDeletionService(30);
    graceService.registerDeleter(mockDeleter);
    const req = graceService.createDeletionRequest('user-123');
    const result = await graceService.executeDeletion(req.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Grace period');
  });

  it('should not execute a cancelled request', async () => {
    const req = service.createDeletionRequest('user-123');
    service.cancelDeletionRequest(req.id, 'user-123');
    const result = await service.executeDeletion(req.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
  });

  it('should list deletion requests for a user', () => {
    service.createDeletionRequest('user-123');
    service.createDeletionRequest('user-123');
    service.createDeletionRequest('user-456');
    expect(service.listDeletionRequests('user-123')).toHaveLength(2);
    expect(service.listDeletionRequests('user-456')).toHaveLength(1);
  });

  it('should list deletion sources', () => {
    expect(service.listDeletionSources()).toContain('subscriptions');
  });
});

describe('GDPR Controller', () => {
  let controller: GdprController;
  let exportService: DataExportService;
  let deletionService: DataDeletionService;

  beforeEach(() => {
    exportService = new DataExportService();
    exportService.registerCollector({
      sourceName: 'test',
      collect: async (userId) => [{ userId, email: 'test@test.com' }],
    });
    deletionService = new DataDeletionService(0);
    deletionService.registerDeleter({
      sourceName: 'test',
      deleteUserData: async () => ({ source: 'test', deletedCount: 1 }),
    });
    controller = new GdprController({ exportService, deletionService });
  });

  it('should handle export request', async () => {
    const res = await controller.handleExportRequest({ userId: 'user-1' });
    expect(res.success).toBe(true);
    expect(res.status).toBe(200);
  });

  it('should reject export without userId', async () => {
    const res = await controller.handleExportRequest({ userId: '' });
    expect(res.success).toBe(false);
    expect(res.status).toBe(400);
  });

  it('should handle deletion request creation', () => {
    const res = controller.handleCreateDeletionRequest({ userId: 'user-1' });
    expect(res.success).toBe(true);
    expect(res.status).toBe(201);
  });

  it('should prevent duplicate deletion requests', () => {
    controller.handleCreateDeletionRequest({ userId: 'user-1' });
    const res = controller.handleCreateDeletionRequest({ userId: 'user-1' });
    expect(res.success).toBe(false);
    expect(res.status).toBe(409);
  });

  it('should handle deletion execution', async () => {
    const createRes = controller.handleCreateDeletionRequest({ userId: 'user-1' });
    const requestId = (createRes.data as { id: string }).id;
    const execRes = await controller.handleExecuteDeletion(requestId);
    expect(execRes.success).toBe(true);
    expect((execRes.data as { status: string }).status).toBe('completed');
  });

  it('should handle deletion request status query', () => {
    const createRes = controller.handleCreateDeletionRequest({ userId: 'user-1' });
    const requestId = (createRes.data as { id: string }).id;
    const res = controller.handleGetDeletionRequest(requestId);
    expect(res.success).toBe(true);
    expect(res.status).toBe(200);
  });

  it('should return 404 for unknown deletion request', () => {
    const res = controller.handleGetDeletionRequest('nonexistent');
    expect(res.success).toBe(false);
    expect(res.status).toBe(404);
  });
});

describe('PII Registry', () => {
  it('should classify email as direct identifier', () => {
    const def = getFieldDefinition('email');
    expect(def?.sensitivity).toBe('direct');
    expect(def?.strategy).toBe('mask');
  });

  it('should identify quasi-identifiers', () => {
    const def = getFieldDefinition('ipAddress');
    expect(def?.quasiIdentifier).toBe(true);
  });

  it('should have all required PII fields registered', () => {
    expect(PII_REGISTRY['email']).toBeDefined();
    expect(PII_REGISTRY['name']).toBeDefined();
    expect(PII_REGISTRY['userId']).toBeDefined();
    expect(PII_REGISTRY['phoneNumber']).toBeDefined();
    expect(PII_REGISTRY['address']).toBeDefined();
  });
});
