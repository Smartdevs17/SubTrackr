export type LoyaltyTierId = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface LoyaltyTierDefinition {
  id: LoyaltyTierId;
  name: string;
  minLifetimePoints: number;
  discountPercent: number;
  reducedFeesPercent: number;
  benefits: string[];
}

export interface LoyaltyRewardDefinition {
  id: string;
  name: string;
  pointsCost: number;
  kind: 'discount' | 'free_month' | 'merchandise';
  valueUsd?: number;
  description: string;
}

export interface LoyaltyBalance {
  subscriberId: string;
  points: number;
  lifetimePoints: number;
  earnedPoints: number;
  redeemedPoints: number;
  expiredPoints: number;
  tier: LoyaltyTierId;
  updatedAt: number;
}

export type LoyaltyLedgerEventType = 'earn' | 'redeem' | 'expire';

export interface LoyaltyLedgerEvent {
  id: string;
  subscriberId: string;
  type: LoyaltyLedgerEventType;
  points: number;
  reason: string;
  rewardId?: string;
  createdAt: number;
}

export interface LoyaltyMutationResult {
  accepted: boolean;
  balance: LoyaltyBalance;
  event?: LoyaltyLedgerEvent;
  previousTier: LoyaltyTierId;
  tierChanged: boolean;
  error?: string;
}

export const LOYALTY_TIERS: readonly LoyaltyTierDefinition[] = [
  {
    id: 'bronze',
    name: 'Bronze',
    minLifetimePoints: 0,
    discountPercent: 0,
    reducedFeesPercent: 0,
    benefits: ['Standard support'],
  },
  {
    id: 'silver',
    name: 'Silver',
    minLifetimePoints: 1000,
    discountPercent: 5,
    reducedFeesPercent: 2,
    benefits: ['5% subscription discount', '2% reduced fees'],
  },
  {
    id: 'gold',
    name: 'Gold',
    minLifetimePoints: 5000,
    discountPercent: 10,
    reducedFeesPercent: 5,
    benefits: ['10% subscription discount', 'Priority support', '5% reduced fees'],
  },
  {
    id: 'platinum',
    name: 'Platinum',
    minLifetimePoints: 15000,
    discountPercent: 15,
    reducedFeesPercent: 10,
    benefits: ['15% subscription discount', 'Priority support', '10% reduced fees'],
  },
];

export const LOYALTY_REWARDS: readonly LoyaltyRewardDefinition[] = [
  {
    id: 'discount_5',
    name: '$5 subscription discount',
    pointsCost: 500,
    kind: 'discount',
    valueUsd: 5,
    description: 'Applies a $5 credit to the next subscription invoice.',
  },
  {
    id: 'discount_10',
    name: '$10 subscription discount',
    pointsCost: 900,
    kind: 'discount',
    valueUsd: 10,
    description: 'Applies a $10 credit to the next subscription invoice.',
  },
  {
    id: 'free_month',
    name: 'Free month',
    pointsCost: 2000,
    kind: 'free_month',
    description: 'Waives the next monthly subscription payment.',
  },
  {
    id: 't_shirt',
    name: 'SubTrackr T-Shirt',
    pointsCost: 5000,
    kind: 'merchandise',
    description: 'Ships a SubTrackr T-Shirt to the subscriber.',
  },
];

export const MAX_POINTS_PER_MEMBER = 10_000_000;

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveLoyaltyTier(lifetimePoints: number): LoyaltyTierDefinition {
  let tier = LOYALTY_TIERS[0];
  for (const candidate of LOYALTY_TIERS) {
    if (lifetimePoints >= candidate.minLifetimePoints) tier = candidate;
  }
  return tier;
}

export function getLoyaltyReward(rewardId: string): LoyaltyRewardDefinition | undefined {
  return LOYALTY_REWARDS.find((reward) => reward.id === rewardId);
}

function emptyBalance(subscriberId: string): LoyaltyBalance {
  return {
    subscriberId,
    points: 0,
    lifetimePoints: 0,
    earnedPoints: 0,
    redeemedPoints: 0,
    expiredPoints: 0,
    tier: 'bronze',
    updatedAt: Date.now(),
  };
}

export class LoyaltyRewardsLedger {
  private balances = new Map<string, LoyaltyBalance>();
  private events: LoyaltyLedgerEvent[] = [];

  getBalance(subscriberId: string): LoyaltyBalance {
    return { ...(this.balances.get(subscriberId) ?? emptyBalance(subscriberId)) };
  }

  getAllBalances(): LoyaltyBalance[] {
    return Array.from(this.balances.values()).map((balance) => ({ ...balance }));
  }

  getEvents(subscriberId: string): LoyaltyLedgerEvent[] {
    return this.events
      .filter((event) => event.subscriberId === subscriberId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((event) => ({ ...event }));
  }

  award(subscriberId: string, points: number, reason: string): LoyaltyMutationResult {
    if (!Number.isFinite(points) || points <= 0) {
      return this.reject(subscriberId, 'Points must be a positive finite number');
    }

    const previous = this.getBalance(subscriberId);
    const awarded = Math.min(Math.floor(points), MAX_POINTS_PER_MEMBER - previous.lifetimePoints);
    if (awarded <= 0) {
      return this.reject(subscriberId, 'Maximum lifetime points reached', previous);
    }

    const balance: LoyaltyBalance = {
      ...previous,
      points: previous.points + awarded,
      lifetimePoints: previous.lifetimePoints + awarded,
      earnedPoints: previous.earnedPoints + awarded,
      tier: resolveLoyaltyTier(previous.lifetimePoints + awarded).id,
      updatedAt: Date.now(),
    };
    return this.commit(subscriberId, previous, balance, 'earn', awarded, reason);
  }

  redeem(subscriberId: string, rewardId: string): LoyaltyMutationResult {
    const reward = getLoyaltyReward(rewardId);
    if (!reward) return this.reject(subscriberId, `Unknown reward "${rewardId}"`);

    const previous = this.getBalance(subscriberId);
    if (previous.points < reward.pointsCost) {
      return this.reject(subscriberId, 'Insufficient points for this reward', previous);
    }

    const balance: LoyaltyBalance = {
      ...previous,
      points: previous.points - reward.pointsCost,
      redeemedPoints: previous.redeemedPoints + reward.pointsCost,
      updatedAt: Date.now(),
    };
    return this.commit(
      subscriberId,
      previous,
      balance,
      'redeem',
      reward.pointsCost,
      `Redeemed ${reward.name}`,
      reward.id,
    );
  }

  expire(subscriberId: string, points: number, reason: string): LoyaltyMutationResult {
    const previous = this.getBalance(subscriberId);
    const expired = Math.min(Math.max(0, Math.floor(points)), previous.points);
    if (expired <= 0) return this.reject(subscriberId, 'No points available to expire', previous);

    const balance: LoyaltyBalance = {
      ...previous,
      points: previous.points - expired,
      expiredPoints: previous.expiredPoints + expired,
      updatedAt: Date.now(),
    };
    return this.commit(subscriberId, previous, balance, 'expire', expired, reason);
  }

  clear(): void {
    this.balances.clear();
    this.events = [];
  }

  private reject(
    subscriberId: string,
    error: string,
    balance: LoyaltyBalance = this.getBalance(subscriberId),
  ): LoyaltyMutationResult {
    return {
      accepted: false,
      balance,
      previousTier: balance.tier,
      tierChanged: false,
      error,
    };
  }

  private commit(
    subscriberId: string,
    previous: LoyaltyBalance,
    balance: LoyaltyBalance,
    type: LoyaltyLedgerEventType,
    points: number,
    reason: string,
    rewardId?: string,
  ): LoyaltyMutationResult {
    const event: LoyaltyLedgerEvent = {
      id: createId('ledger'),
      subscriberId,
      type,
      points,
      reason,
      rewardId,
      createdAt: Date.now(),
    };
    this.balances.set(subscriberId, balance);
    this.events.push(event);
    return {
      accepted: true,
      balance: { ...balance },
      event,
      previousTier: previous.tier,
      tierChanged: previous.tier !== balance.tier,
    };
  }
}
