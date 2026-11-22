import { AuditContext, withAuditColumns, AUDIT_TABLES } from '../auditColumns';

describe('AuditContext', () => {
  it('creates from user request', () => {
    const ctx = AuditContext.fromRequest({ userId: 'user-123' });
    expect(ctx.actorId).toBe('user-123');
    expect(ctx.actorType).toBe('user');
  });

  it('creates from nested user object', () => {
    const ctx = AuditContext.fromRequest({ user: { id: 'user-456' } });
    expect(ctx.actorId).toBe('user-456');
    expect(ctx.actorType).toBe('user');
  });

  it('creates from API key request', () => {
    const ctx = AuditContext.fromRequest({ apiKey: { id: 'key-789' } });
    expect(ctx.actorId).toBe('key-789');
    expect(ctx.actorType).toBe('api_key');
  });

  it('defaults to system when no actor is present', () => {
    const ctx = AuditContext.fromRequest({});
    expect(ctx.actorId).toBe('system');
    expect(ctx.actorType).toBe('system');
  });

  it('system() creates a system context', () => {
    const ctx = AuditContext.system();
    expect(ctx.actorId).toBe('system');
    expect(ctx.actorType).toBe('system');
  });

  it('anonymous() creates an anonymous context', () => {
    const ctx = AuditContext.anonymous();
    expect(ctx.actorId).toBe('anonymous');
    expect(ctx.actorType).toBe('system');
  });
});

describe('withAuditColumns.insert', () => {
  it('builds INSERT with created_by and updated_by', () => {
    const ctx = new AuditContext('user-123', 'user');
    const { sql, params } = withAuditColumns.insert(
      'subscriptions',
      { user_id: 'u1', name: 'Pro', amount: 99 },
      ctx,
    );

    expect(sql).toContain('INSERT INTO subscriptions');
    expect(sql).toContain('created_by');
    expect(sql).toContain('updated_by');
    expect(params).toEqual(['u1', 'Pro', 99, 'user-123', 'user-123']);
  });

  it('generates correct placeholder numbering', () => {
    const ctx = AuditContext.system();
    const { sql } = withAuditColumns.insert(
      'users',
      { email: 'a@b.com', name: 'Alice' },
      ctx,
    );
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).toContain('$3');
    expect(sql).toContain('$4');
  });
});

describe('withAuditColumns.update', () => {
  it('builds UPDATE with updated_by', () => {
    const ctx = new AuditContext('user-456', 'user');
    const { sql, params } = withAuditColumns.update(
      'subscriptions',
      { status: 'active', amount: 199 },
      'id = $1',
      ['sub-123'],
      ctx,
    );

    expect(sql).toContain('UPDATE subscriptions SET');
    expect(sql).toContain('status =');
    expect(sql).toContain('amount =');
    expect(sql).toContain('updated_by =');
    expect(sql).toContain('WHERE id =');
    expect(params).toContain('user-456');
    expect(params).toContain('sub-123');
  });

  it('handles multiple WHERE params', () => {
    const ctx = AuditContext.system();
    const { sql, params } = withAuditColumns.update(
      'transactions',
      { status: 'completed' },
      'user_id = $1 AND id = $2',
      ['u1', 't1'],
      ctx,
    );

    expect(params).toEqual(['completed', 'system', 'u1', 't1']);
    expect(sql).toContain('WHERE user_id =');
    expect(sql).toContain('AND id =');
  });
});

describe('AUDIT_TABLES', () => {
  it('includes all core entity tables', () => {
    expect(AUDIT_TABLES).toContain('subscriptions');
    expect(AUDIT_TABLES).toContain('transactions');
    expect(AUDIT_TABLES).toContain('users');
    expect(AUDIT_TABLES).toContain('merchants');
    expect(AUDIT_TABLES).toContain('loyalty');
    expect(AUDIT_TABLES).toContain('payment_methods');
    expect(AUDIT_TABLES).toContain('plans');
  });
});
