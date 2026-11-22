import type {
  BillingAllocationStrategy,
  CustomBillingWeights,
  MemberBillingAllocation,
  MemberBillingAllocationItem,
  SubscriptionGroup,
} from '../types/group';

const roundCents = (value: number): number => Math.round(value * 100) / 100;

const strategyDescription = (strategy: BillingAllocationStrategy): string => {
  switch (strategy) {
    case 'equal':
      return 'Equal share of group bill';
    case 'usage_weighted':
      return 'usage-weighted share of group bill';
    case 'custom_weights':
      return 'custom-weighted share of group bill';
    case 'owner_pays':
      return 'owner-paid group bill';
  }
};

const resolveWeights = (
  group: SubscriptionGroup,
  strategy: BillingAllocationStrategy,
  customWeights?: CustomBillingWeights
): Map<string, number> => {
  const weights = new Map<string, number>();

  if (strategy === 'owner_pays') {
    for (const member of group.members) {
      weights.set(member.address, member.address === group.owner ? 1 : 0);
    }
    return weights;
  }

  if (strategy === 'equal') {
    for (const member of group.members) {
      weights.set(member.address, 1);
    }
    return weights;
  }

  if (strategy === 'usage_weighted') {
    const totalUsage = group.members.reduce((sum, m) => sum + Math.max(m.usageUnits, 0), 0);
    if (totalUsage <= 0) {
      for (const member of group.members) {
        weights.set(member.address, 1);
      }
      return weights;
    }
    for (const member of group.members) {
      weights.set(member.address, Math.max(member.usageUnits, 0));
    }
    return weights;
  }

  // custom_weights
  if (!customWeights || Object.keys(customWeights).length === 0) {
    throw new Error('custom_weights strategy requires a non-empty customWeights map');
  }

  for (const member of group.members) {
    const weight = customWeights[member.address];
    if (weight === undefined) {
      throw new Error(`Missing custom weight for member ${member.address}`);
    }
    if (weight < 0) {
      throw new Error(`Custom weight for ${member.address} must be non-negative`);
    }
    weights.set(member.address, weight);
  }

  const totalWeight = Array.from(weights.values()).reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    throw new Error('custom_weights must sum to a positive total');
  }

  return weights;
};

/**
 * Allocate a group charge across members using the selected strategy.
 * Remainder cents after rounding are applied to the last billable member
 * (or the owner for owner_pays) so the sum always equals totalAmount.
 */
export const allocateMemberBilling = (
  group: SubscriptionGroup,
  totalAmount: number,
  strategy: BillingAllocationStrategy,
  customWeights?: CustomBillingWeights
): MemberBillingAllocation => {
  if (totalAmount < 0) throw new Error('totalAmount must be non-negative');
  if (group.members.length === 0) throw new Error('Group has no members to allocate billing to');

  const weights = resolveWeights(group, strategy, customWeights);
  const totalWeight = Array.from(weights.values()).reduce((sum, w) => sum + w, 0);

  if (totalWeight <= 0 && strategy !== 'owner_pays') {
    throw new Error('Allocation weights must sum to a positive total');
  }

  const description = strategyDescription(strategy);
  const items: MemberBillingAllocationItem[] = [];
  let allocated = 0;

  const ordered = [...group.members];
  // Prefer applying remainder to owner when they have a non-zero weight.
  ordered.sort((a, b) => {
    if (a.address === group.owner) return 1;
    if (b.address === group.owner) return -1;
    return 0;
  });

  for (let i = 0; i < ordered.length; i++) {
    const member = ordered[i];
    const weight = weights.get(member.address) ?? 0;
    const sharePercent = totalWeight > 0 ? (weight / totalWeight) * 100 : 0;
    const isLast = i === ordered.length - 1;
    let amount: number;

    if (totalAmount === 0 || totalWeight === 0) {
      amount = 0;
    } else if (isLast) {
      amount = roundCents(totalAmount - allocated);
    } else {
      amount = roundCents((totalAmount * weight) / totalWeight);
      allocated = roundCents(allocated + amount);
    }

    items.push({
      memberAddress: member.address,
      amount,
      weight,
      sharePercent: Number(sharePercent.toFixed(4)),
      description:
        strategy === 'owner_pays' && member.address === group.owner
          ? 'Owner pays full group bill'
          : strategy === 'owner_pays'
            ? 'Covered by owner'
            : description,
    });
  }

  return {
    groupId: group.groupId,
    strategy,
    totalAmount,
    items,
    allocatedAt: new Date(),
  };
};

/**
 * Apply an allocation result onto each member's outstandingBalance.
 * Returns a new group object (does not mutate the input).
 */
export const applyAllocationToMembers = (
  group: SubscriptionGroup,
  allocation: MemberBillingAllocation
): SubscriptionGroup => {
  if (allocation.groupId !== group.groupId) {
    throw new Error('Allocation groupId does not match group');
  }

  const amountByMember = new Map(allocation.items.map((item) => [item.memberAddress, item.amount]));

  return {
    ...group,
    members: group.members.map((member) => ({
      ...member,
      outstandingBalance: roundCents(
        member.outstandingBalance + (amountByMember.get(member.address) ?? 0)
      ),
    })),
    updatedAt: new Date(),
  };
};
