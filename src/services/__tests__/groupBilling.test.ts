import { GroupBillingService } from '../../../backend/services/billing/groupBilling';
import type { SubscriptionGroup } from '../../types/group';

describe('GroupBillingService', () => {
  let service: GroupBillingService;
  let sampleGroup: SubscriptionGroup;

  beforeEach(() => {
    service = new GroupBillingService();
    sampleGroup = {
      groupId: 'grp_test_1',
      groupName: 'Dev Family',
      ownerAddress: '0xOWNER',
      members: [
        {
          address: '0xOWNER',
          role: 'owner',
          joinedAt: new Date('2025-01-01'),
          usageUnits: 150,
          outstandingBalance: 0,
        },
        {
          address: '0xMEMBER1',
          role: 'admin',
          joinedAt: new Date('2025-01-15'),
          usageUnits: 50,
          outstandingBalance: 10,
        },
      ],
      planSharingRules: {
        seatLimit: 5,
        familyPlanPrice: 29.99,
        perSeatPrice: 5.0,
        usagePoolLimit: 500,
        allowMemberInvites: true,
      },
      charges: [
        {
          id: 'chg_1',
          groupId: 'grp_test_1',
          chargedAt: new Date(),
          amount: 39.99,
          breakdown: [
            { memberAddress: '0xOWNER', amount: 29.99 },
            { memberAddress: '0xMEMBER1', amount: 10.0 },
          ],
          txHash: '0xHASH1',
        },
      ],
      createdAt: new Date('2025-01-01'),
    };
  });

  it('generates billing summary correctly', () => {
    const summary = service.generateBillingSummary(sampleGroup);
    expect(summary.groupId).toBe('grp_test_1');
    expect(summary.totalCharges).toBe(1);
    expect(summary.totalAmount).toBeCloseTo(39.99);
    expect(summary.outstandingBalance).toBe(10);
    expect(summary.memberBalances['0xMEMBER1']).toBe(10);
  });

  it('aggregates charges within period', () => {
    const items = service.aggregateCharges(sampleGroup, 30);
    expect(items.length).toBe(2);
    const ownerItem = items.find((i) => i.memberAddress === '0xOWNER');
    expect(ownerItem?.amount).toBe(29.99);
  });

  it('generates and processes invoices', () => {
    const now = Date.now();
    const invoice = service.generateInvoice(sampleGroup, now - 86400000, now);
    expect(invoice.groupId).toBe('grp_test_1');
    expect(invoice.status).toBe('draft');
    expect(invoice.totalAmount).toBeCloseTo(39.99);

    const issued = service.issueInvoice(invoice.id, 'grp_test_1');
    expect(issued?.status).toBe('issued');
    expect(issued?.issuedAt).toBeDefined();

    const paid = service.markInvoicePaid(invoice.id, 'grp_test_1');
    expect(paid?.status).toBe('paid');
    expect(paid?.paidAt).toBeDefined();
  });

  it('calculates group analytics with seat and usage utilization', () => {
    const analytics = service.calculateGroupAnalytics(sampleGroup);
    expect(analytics.groupId).toBe('grp_test_1');
    expect(analytics.activeSeats).toBe(2);
    expect(analytics.seatLimit).toBe(5);
    expect(analytics.totalUsage).toBe(200);
    expect(analytics.usagePoolLimit).toBe(500);
  });

  it('evaluates role permissions correctly', () => {
    const ownerCheck = service.canPerformAction(sampleGroup, '0xOWNER', 'invite');
    expect(ownerCheck.allowed).toBe(true);

    const adminCheck = service.canPerformAction(sampleGroup, '0xMEMBER1', 'billing_override');
    expect(adminCheck.allowed).toBe(false);
    expect(adminCheck.reason).toContain('Role "admin" cannot perform');

    const nonMemberCheck = service.canPerformAction(sampleGroup, '0xSTRANGER', 'invite');
    expect(nonMemberCheck.allowed).toBe(false);
    expect(nonMemberCheck.reason).toContain('not a group member');
  });

  it('records admin actions', () => {
    const action = service.recordAdminAction('grp_test_1', 'invite', '0xOWNER', '0xNEW');
    expect(action.groupId).toBe('grp_test_1');
    expect(action.action).toBe('invite');

    const history = service.getAdminActions('grp_test_1');
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(action.id);
  });

  it('handles plan customizations and billing overrides', () => {
    const plan = service.customizeGroupPlan('grp_test_1', {
      basePlanId: 'plan_family',
      customName: 'Custom Enterprise Family',
      sharedFeatures: ['feature_a', 'feature_b'],
      memberLimits: { '0xOWNER': 100 },
      ownerDiscount: 10,
    });
    expect(plan.customName).toBe('Custom Enterprise Family');
    expect(service.getGroupPlanCustomization('grp_test_1')).toEqual(plan);

    const updatedMember = service.overrideMemberBalance(
      sampleGroup,
      '0xMEMBER1',
      0,
      '0xOWNER'
    );
    expect(updatedMember?.outstandingBalance).toBe(0);
  });
});
