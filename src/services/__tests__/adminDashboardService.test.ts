import {
  bulkUpdateSubscriptions,
  cycleSubscriptionStatus,
  deleteSubscription,
  filterAuditLog,
  getAdminDashboardData,
  toggleMerchantStatus,
  updateUserRole,
  upsertSubscription,
  type AdminUserRecord,
  type MerchantRecord,
  type SubscriptionAdminRecord,
} from '../adminDashboardService';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeMerchant(overrides: Partial<MerchantRecord> = {}): MerchantRecord {
  return {
    id: 'merch_1',
    name: 'Test',
    status: 'active',
    activePlans: 5,
    monthlyRevenue: 1000,
    ...overrides,
  };
}

function makeSub(overrides: Partial<SubscriptionAdminRecord> = {}): SubscriptionAdminRecord {
  return {
    id: 'sub_1',
    name: 'Pro Plan',
    merchantId: 'merch_1',
    merchantName: 'Test',
    amount: 29,
    currency: 'USD',
    status: 'active',
    ...overrides,
  };
}

function makeUser(overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    id: 'user_1',
    name: 'Test User',
    email: 'test@example.com',
    role: 'analyst',
    ...overrides,
  };
}

// ── getAdminDashboardData ────────────────────────────────────────────────

describe('adminDashboardService', () => {
  it('returns seeded dashboard data', () => {
    const data = getAdminDashboardData('admin');

    expect(data.merchants.length).toBeGreaterThan(0);
    expect(data.analytics.totalTransactions).toBeGreaterThan(0);
    expect(data.auditLog.length).toBeGreaterThan(0);
  });

  it('returns immutable copies — mutations do not affect source', () => {
    const a = getAdminDashboardData('admin');
    const b = getAdminDashboardData('admin');
    a.merchants[0].status = 'suspended';
    expect(b.merchants[0].status).not.toBe('suspended');
  });

  it('supports bulk pause operations for elevated roles', () => {
    const data = getAdminDashboardData('analyst');
    const updated = bulkUpdateSubscriptions(data.subscriptions, ['sub_1'], 'analyst');

    expect(updated.find((subscription) => subscription.id === 'sub_1')?.status).toBe('paused');
  });

  it('prevents support from deleting subscriptions', () => {
    const data = getAdminDashboardData('support');
    const updated = deleteSubscription(data.subscriptions, 'sub_1', 'support');

    expect(updated).toHaveLength(data.subscriptions.length);
  });

  it('allows admins to add drafts and rotate user roles', () => {
    const data = getAdminDashboardData('admin');
    const withDraft = upsertSubscription(data.subscriptions, 'admin');
    const nextUsers = updateUserRole(data.users, 'user_2', 'admin');

    expect(withDraft[0]?.status).toBe('draft');
    expect(nextUsers.find((user) => user.id === 'user_2')?.role).toBe('support');
  });
});

// ── toggleMerchantStatus ─────────────────────────────────────────────────

describe('toggleMerchantStatus', () => {
  it('admin: suspends an active merchant', () => {
    expect(toggleMerchantStatus(makeMerchant({ status: 'active' }), 'admin').status).toBe(
      'suspended'
    );
  });

  it('admin: activates a suspended merchant', () => {
    expect(toggleMerchantStatus(makeMerchant({ status: 'suspended' }), 'admin').status).toBe(
      'active'
    );
  });

  it('non-admin roles: return merchant unchanged', () => {
    const m = makeMerchant({ status: 'active' });
    expect(toggleMerchantStatus(m, 'analyst').status).toBe('active');
    expect(toggleMerchantStatus(m, 'support').status).toBe('active');
  });

  it('does not mutate the original object', () => {
    const m = makeMerchant({ status: 'active' });
    toggleMerchantStatus(m, 'admin');
    expect(m.status).toBe('active');
  });
});

// ── upsertSubscription ───────────────────────────────────────────────────

describe('upsertSubscription', () => {
  it('admin: prepends a new draft subscription', () => {
    const result = upsertSubscription([makeSub()], 'admin');
    expect(result.length).toBe(2);
    expect(result[0].status).toBe('draft');
  });

  it('analyst: can create a draft', () => {
    expect(upsertSubscription([makeSub()], 'analyst').length).toBe(2);
  });

  it('support: cannot create subscriptions', () => {
    expect(upsertSubscription([makeSub()], 'support').length).toBe(1);
  });
});

// ── cycleSubscriptionStatus ──────────────────────────────────────────────

describe('cycleSubscriptionStatus', () => {
  it('admin: draft → active', () => {
    expect(cycleSubscriptionStatus(makeSub({ status: 'draft' }), 'admin').status).toBe('active');
  });

  it('admin: active → paused', () => {
    expect(cycleSubscriptionStatus(makeSub({ status: 'active' }), 'admin').status).toBe('paused');
  });

  it('admin: paused → active', () => {
    expect(cycleSubscriptionStatus(makeSub({ status: 'paused' }), 'admin').status).toBe('active');
  });

  it('support: returns subscription unchanged', () => {
    expect(cycleSubscriptionStatus(makeSub({ status: 'active' }), 'support').status).toBe('active');
  });
});

// ── deleteSubscription ───────────────────────────────────────────────────

describe('deleteSubscription', () => {
  it('admin: removes the matching subscription', () => {
    const subs = [makeSub({ id: 'sub_a' }), makeSub({ id: 'sub_b' })];
    const result = deleteSubscription(subs, 'sub_a', 'admin');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('sub_b');
  });

  it('non-admin: returns list unchanged', () => {
    const subs = [makeSub()];
    expect(deleteSubscription(subs, 'sub_1', 'analyst').length).toBe(1);
    expect(deleteSubscription(subs, 'sub_1', 'support').length).toBe(1);
  });
});

// ── bulkUpdateSubscriptions ──────────────────────────────────────────────

describe('bulkUpdateSubscriptions', () => {
  it('pauses only selected subscriptions', () => {
    const subs = [makeSub({ id: 'a', status: 'active' }), makeSub({ id: 'b', status: 'active' })];
    const result = bulkUpdateSubscriptions(subs, ['a'], 'admin');
    expect(result.find((s) => s.id === 'a')!.status).toBe('paused');
    expect(result.find((s) => s.id === 'b')!.status).toBe('active');
  });

  it('support: returns list unchanged', () => {
    const subs = [makeSub({ status: 'active' })];
    expect(bulkUpdateSubscriptions(subs, ['sub_1'], 'support')[0].status).toBe('active');
  });

  it('empty selection: no changes', () => {
    const subs = [makeSub({ status: 'active' })];
    expect(bulkUpdateSubscriptions(subs, [], 'admin')[0].status).toBe('active');
  });
});

// ── updateUserRole ───────────────────────────────────────────────────────

describe('updateUserRole', () => {
  it('admin: viewer → analyst', () => {
    expect(updateUserRole([makeUser({ id: 'u1', role: 'viewer' })], 'u1', 'admin')[0].role).toBe(
      'analyst'
    );
  });

  it('admin: analyst → support', () => {
    expect(updateUserRole([makeUser({ id: 'u1', role: 'analyst' })], 'u1', 'admin')[0].role).toBe(
      'support'
    );
  });

  it('admin: support → viewer', () => {
    expect(updateUserRole([makeUser({ id: 'u1', role: 'support' })], 'u1', 'admin')[0].role).toBe(
      'viewer'
    );
  });

  it('non-admin: returns list unchanged', () => {
    const users = [makeUser({ id: 'u1', role: 'analyst' })];
    expect(updateUserRole(users, 'u1', 'analyst')[0].role).toBe('analyst');
    expect(updateUserRole(users, 'u1', 'support')[0].role).toBe('analyst');
  });
});

// ── filterAuditLog ───────────────────────────────────────────────────────

describe('filterAuditLog', () => {
  const { auditLog } = getAdminDashboardData('admin');

  it('filters by resourceType', () => {
    const results = filterAuditLog(auditLog, { resourceType: 'merchant' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((e) => e.resourceType === 'merchant')).toBe(true);
  });

  it('filters by action', () => {
    const results = filterAuditLog(auditLog, { action: 'subscription.paused' });
    expect(results.every((e) => e.action === 'subscription.paused')).toBe(true);
  });

  it('filters by actorId', () => {
    const results = filterAuditLog(auditLog, { actorId: 'user_1' });
    expect(results.every((e) => e.actorId === 'user_1')).toBe(true);
  });

  it('returns all events when no filter criteria given', () => {
    expect(filterAuditLog(auditLog, {}).length).toBe(auditLog.length);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterAuditLog(auditLog, { actorId: 'nobody' }).length).toBe(0);
  });

  it('applies multiple criteria as AND', () => {
    const results = filterAuditLog(auditLog, { resourceType: 'subscription', actorId: 'user_2' });
    expect(results.every((e) => e.resourceType === 'subscription' && e.actorId === 'user_2')).toBe(
      true
    );
  });
});
