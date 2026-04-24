import {
  bulkUpdateSubscriptions,
  deleteSubscription,
  getAdminDashboardData,
  updateUserRole,
  upsertSubscription,
} from '../adminDashboardService';

describe('adminDashboardService', () => {
  it('returns seeded dashboard data', () => {
    const data = getAdminDashboardData('admin');

    expect(data.merchants.length).toBeGreaterThan(0);
    expect(data.analytics.totalTransactions).toBeGreaterThan(0);
    expect(data.auditLog.length).toBeGreaterThan(0);
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
