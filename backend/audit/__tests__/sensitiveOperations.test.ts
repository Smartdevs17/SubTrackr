import { HashChainService } from '../domain/HashChainService';
import { AuditWriter } from '../domain/AuditWriter';
import { SensitiveOpsAuditController } from '../controller/sensitiveOpsAuditController';
import {
  SENSITIVE_OPERATIONS,
  getSensitiveOperation,
  isSensitiveOperation,
  listSensitiveOperations,
  listSensitiveOperationsByCategory,
  listSensitiveOperationsBySeverity,
} from '../sensitiveOperations';

describe('Sensitive Operations Registry', () => {
  it('should contain operations across all categories', () => {
    const ops = listSensitiveOperations();
    expect(ops.length).toBeGreaterThanOrEqual(15);
    const categories = new Set(ops.map((o) => o.category));
    expect(categories.has('authentication')).toBe(true);
    expect(categories.has('payment')).toBe(true);
    expect(categories.has('data_access')).toBe(true);
    expect(categories.has('data_modification')).toBe(true);
    expect(categories.has('admin')).toBe(true);
    expect(categories.has('security')).toBe(true);
    expect(categories.has('compliance')).toBe(true);
  });

  it('should look up operations by key', () => {
    expect(getSensitiveOperation('payment.charge')).toBeDefined();
    expect(getSensitiveOperation('payment.charge')?.severity).toBe('high');
    expect(getSensitiveOperation('nonexistent')).toBeUndefined();
  });

  it('should check if operation is registered', () => {
    expect(isSensitiveOperation('auth.login')).toBe(true);
    expect(isSensitiveOperation('unknown.key')).toBe(false);
  });

  it('should filter by category', () => {
    const paymentOps = listSensitiveOperationsByCategory('payment');
    expect(paymentOps.length).toBeGreaterThanOrEqual(3);
    expect(paymentOps.every((o) => o.category === 'payment')).toBe(true);
  });

  it('should filter by severity', () => {
    const criticalOps = listSensitiveOperationsBySeverity('critical');
    expect(criticalOps.length).toBeGreaterThanOrEqual(1);
    expect(criticalOps.every((o) => o.severity === 'critical')).toBe(true);
  });

  it('should flag operations requiring a reason', () => {
    expect(SENSITIVE_OPERATIONS['payment.refund'].requiresReason).toBe(true);
    expect(SENSITIVE_OPERATIONS['auth.login'].requiresReason).toBe(false);
  });
});

describe('SensitiveOpsAuditController', () => {
  let chain: HashChainService;
  let writer: AuditWriter;
  let controller: SensitiveOpsAuditController;

  beforeEach(() => {
    chain = new HashChainService();
    writer = new AuditWriter(chain);
    controller = new SensitiveOpsAuditController(writer);
  });

  it('should audit a simple sensitive operation', () => {
    const result = controller.audit('auth.login', {
      actorId: 'user-123',
      resourceId: 'user-123',
      ipAddress: '192.168.1.1',
    });
    expect(result.success).toBe(true);
    expect(result.auditEntry).not.toBeNull();
    expect(result.auditEntry?.action).toBe('auth.login');
    expect(result.auditEntry?.actorId).toBe('user-123');
    expect(result.auditEntry?.metadata['operationKey']).toBe('auth.login');
    expect(result.auditEntry?.metadata['ipAddress']).toBe('192.168.1.1');
  });

  it('should reject unknown operation keys', () => {
    const result = controller.audit('unknown.op', {
      actorId: 'user-123',
      resourceId: 'r-1',
    });
    expect(result.success).toBe(false);
    expect(result.auditEntry).toBeNull();
    expect(result.error).toContain('Unknown sensitive operation');
  });

  it('should enforce required reason', () => {
    const result = controller.audit('payment.refund', {
      actorId: 'admin-1',
      resourceId: 'pay-456',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires a reason');
  });

  it('should accept a valid reason', () => {
    const result = controller.audit('payment.refund', {
      actorId: 'admin-1',
      resourceId: 'pay-456',
      reason: 'Customer request #789',
    });
    expect(result.success).toBe(true);
    expect(result.auditEntry?.metadata['reason']).toBe('Customer request #789');
  });

  it('should capture state for data modification operations', () => {
    const oldState = { status: 'active', plan: 'pro' };
    const newState = { status: 'cancelled', plan: 'pro' };
    const result = controller.auditWithState(
      'subscription.cancel',
      { actorId: 'user-123', resourceId: 'sub-999', reason: 'No longer needed' },
      oldState,
      newState,
    );
    expect(result.success).toBe(true);
    expect(result.auditEntry?.oldState).toEqual(oldState);
    expect(result.auditEntry?.newState).toEqual(newState);
  });

  it('should not capture state for operations with captureState=false', () => {
    const result = controller.auditWithState(
      'auth.login',
      { actorId: 'user-123', resourceId: 'user-123' },
      { foo: 'bar' },
      { foo: 'baz' },
    );
    expect(result.success).toBe(true);
    expect(result.auditEntry?.oldState).toBeNull();
    expect(result.auditEntry?.newState).toBeNull();
  });

  it('should wrap an async handler and audit it', async () => {
    const wrapped = controller.wrap(
      'subscription.create',
      { actorId: 'user-123', resourceId: 'sub-100' },
      async () => ({ id: 'sub-100', status: 'active' }),
      () => ({ oldState: null, newState: { id: 'sub-100', status: 'active' } }),
    );
    const result = await wrapped();
    expect(result.id).toBe('sub-100');
    expect(result._audit.success).toBe(true);
    expect(result._audit.auditEntry?.action).toBe('subscription.create');
  });

  it('should audit failed operations with error metadata', async () => {
    const wrapped = controller.wrap(
      'payment.charge',
      { actorId: 'user-123', resourceId: 'pay-200' },
      async () => {
        throw new Error('Insufficient funds');
      },
    );
    await expect(wrapped()).rejects.toThrow('Insufficient funds');
    const entries = chain.getChain();
    expect(entries.length).toBe(1);
    expect(entries[0].metadata['failed']).toBe(true);
    expect(entries[0].metadata['error']).toBe('Insufficient funds');
  });

  it('should record metadata including category and severity', () => {
    const result = controller.audit('admin.user_role_change', {
      actorId: 'admin-1',
      resourceId: 'user-456',
      reason: 'Promotion to admin',
      metadata: { oldRole: 'member', newRole: 'admin' },
    });
    expect(result.success).toBe(true);
    expect(result.auditEntry?.metadata['category']).toBe('admin');
    expect(result.auditEntry?.metadata['severity']).toBe('critical');
    expect(result.auditEntry?.metadata['oldRole']).toBe('member');
    expect(result.auditEntry?.metadata['newRole']).toBe('admin');
  });

  it('should verify chain integrity after multiple audit entries', () => {
    controller.audit('auth.login', { actorId: 'u1', resourceId: 'u1' });
    controller.audit('payment.charge', { actorId: 'u1', resourceId: 'pay-1' });
    controller.auditWithState(
      'subscription.cancel',
      { actorId: 'u1', resourceId: 'sub-1', reason: 'Test' },
      { status: 'active' },
      { status: 'cancelled' },
    );
    const verification = chain.verify();
    expect(verification.valid).toBe(true);
    expect(chain.getChainLength()).toBe(3);
  });
});
