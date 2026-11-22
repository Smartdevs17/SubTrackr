import { allocateMemberBilling, applyAllocationToMembers } from '../groupBillingAllocation';
import {
  changeMemberRole,
  chargeGroupWithAllocation,
  createSubscriptionGroup,
  inviteGroupMember,
  joinGroupWithInvite,
} from '../groupService';
import type { SubscriptionGroup } from '../../types/group';

const buildGroup = (overrides?: {
  usage?: Record<string, number>;
  ownerPays?: boolean;
}): SubscriptionGroup => {
  let group = createSubscriptionGroup('owner', {
    name: 'Alloc Team',
    planSharingRules: {
      seatLimit: 5,
      ownerPaysForMembers: overrides?.ownerPays ?? false,
      allowMemberOverages: false,
    },
  });

  group = inviteGroupMember(group, 'alice', 'owner');
  group = joinGroupWithInvite(group, group.invites[0].id, 'Alice');
  group = inviteGroupMember(group, 'bob', 'owner');
  group = joinGroupWithInvite(group, group.invites[1].id, 'Bob');

  if (overrides?.usage) {
    group = {
      ...group,
      members: group.members.map((m) => ({
        ...m,
        usageUnits: overrides.usage![m.address] ?? m.usageUnits,
      })),
    };
  }

  return group;
};

const sumAmounts = (allocation: { items: Array<{ amount: number }> }): number =>
  Math.round(allocation.items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;

describe('groupBillingAllocation', () => {
  it('splits equally across all members', () => {
    const group = buildGroup();
    const allocation = allocateMemberBilling(group, 90, 'equal');

    expect(allocation.strategy).toBe('equal');
    expect(allocation.items).toHaveLength(3);
    expect(sumAmounts(allocation)).toBe(90);
    for (const item of allocation.items) {
      expect(item.amount).toBe(30);
      expect(item.weight).toBe(1);
    }
  });

  it('allocates remainder cents so totals still match', () => {
    const group = buildGroup();
    const allocation = allocateMemberBilling(group, 100, 'equal');

    expect(sumAmounts(allocation)).toBe(100);
    const amounts = allocation.items.map((i) => i.amount).sort((a, b) => a - b);
    expect(amounts[0]).toBeCloseTo(33.33, 2);
    expect(amounts[2]).toBeCloseTo(33.34, 2);
  });

  it('weights by usage units', () => {
    const group = buildGroup({ usage: { owner: 1, alice: 2, bob: 1 } });
    const allocation = allocateMemberBilling(group, 100, 'usage_weighted');

    expect(sumAmounts(allocation)).toBe(100);
    const byAddress = Object.fromEntries(allocation.items.map((i) => [i.memberAddress, i.amount]));
    expect(byAddress.alice).toBe(50);
    expect(byAddress.owner).toBe(25);
    expect(byAddress.bob).toBe(25);
  });

  it('falls back to equal when usage is all zero', () => {
    const group = buildGroup({ usage: { owner: 0, alice: 0, bob: 0 } });
    const allocation = allocateMemberBilling(group, 60, 'usage_weighted');

    expect(sumAmounts(allocation)).toBe(60);
    for (const item of allocation.items) {
      expect(item.amount).toBe(20);
    }
  });

  it('applies custom weights', () => {
    const group = buildGroup();
    const allocation = allocateMemberBilling(group, 100, 'custom_weights', {
      owner: 1,
      alice: 3,
      bob: 0,
    });

    expect(sumAmounts(allocation)).toBe(100);
    const byAddress = Object.fromEntries(allocation.items.map((i) => [i.memberAddress, i.amount]));
    expect(byAddress.owner).toBe(25);
    expect(byAddress.alice).toBe(75);
    expect(byAddress.bob).toBe(0);
  });

  it('rejects custom_weights without a map', () => {
    const group = buildGroup();
    expect(() => allocateMemberBilling(group, 50, 'custom_weights')).toThrow(
      'custom_weights strategy requires'
    );
  });

  it('rejects missing custom weight for a member', () => {
    const group = buildGroup();
    expect(() =>
      allocateMemberBilling(group, 50, 'custom_weights', { owner: 1, alice: 1 })
    ).toThrow('Missing custom weight');
  });

  it('rejects negative totalAmount', () => {
    const group = buildGroup();
    expect(() => allocateMemberBilling(group, -1, 'equal')).toThrow('non-negative');
  });

  it('assigns the full bill to the owner with owner_pays', () => {
    const group = buildGroup();
    const allocation = allocateMemberBilling(group, 120, 'owner_pays');

    expect(sumAmounts(allocation)).toBe(120);
    const byAddress = Object.fromEntries(allocation.items.map((i) => [i.memberAddress, i.amount]));
    expect(byAddress.owner).toBe(120);
    expect(byAddress.alice).toBe(0);
    expect(byAddress.bob).toBe(0);
  });

  it('applies allocation to outstanding balances without mutating input', () => {
    const group = buildGroup();
    const allocation = allocateMemberBilling(group, 90, 'equal');
    const updated = applyAllocationToMembers(group, allocation);

    expect(group.members.every((m) => m.outstandingBalance === 0)).toBe(true);
    expect(updated.members.every((m) => m.outstandingBalance === 30)).toBe(true);
  });

  it('rejects allocation for a different group', () => {
    const group = buildGroup();
    const allocation = allocateMemberBilling(group, 30, 'equal');
    const other = { ...group, groupId: 'other_group' };

    expect(() => applyAllocationToMembers(other, allocation)).toThrow(
      'Allocation groupId does not match'
    );
  });

  it('chargeGroupWithAllocation persists charge and balances', () => {
    const group = buildGroup();
    const { group: charged, charge, allocation } = chargeGroupWithAllocation(group, 90, 'equal');

    expect(charge.amount).toBe(90);
    expect(charged.charges).toHaveLength(1);
    expect(allocation.items).toHaveLength(3);
    expect(charged.members.reduce((s, m) => s + m.outstandingBalance, 0)).toBe(90);
  });

  it('changeMemberRole promotes a member to admin', () => {
    const group = buildGroup();
    const updated = changeMemberRole(group, 'alice', 'admin');
    expect(updated.members.find((m) => m.address === 'alice')?.role).toBe('admin');
  });

  it('changeMemberRole blocks owner reassignment', () => {
    const group = buildGroup();
    expect(() => changeMemberRole(group, 'alice', 'owner')).toThrow('ownership transfer');
    expect(() => changeMemberRole(group, 'owner', 'admin')).toThrow('Cannot change the owner');
  });
});
