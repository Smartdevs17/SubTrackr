/**
 * Billing Engine (Refactored with Strategy Pattern)
 *
 * Orchestrates billing operations using pluggable pricing strategies.
 * Supports strategy selection based on plan type, runtime overrides,
 * and comprehensive pricing analytics.
 */

import {
  PricingStrategy,
  PricingContext,
  PricingResult,
  PricingAnalytics,
} from './pricingStrategy';
import { PricingStrategyFactory, PlanType, StrategyConfig } from './strategyFactory';

export interface BillingEngineConfig {
  defaultPlanType: PlanType;
  enableAnalytics: boolean;
  enableABTesting: boolean;
}

export interface BillingRecord {
  subscriptionId: string;
  subscriberAddress: string;
  planId: string;
  planType: PlanType;
  amount: number;
  currency: string;
  strategyUsed: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface GroupMember {
  address: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface GroupSubscription {
  groupId: string;
  masterSubscriptionId: string;
  createdBy: string;
  planType: PlanType;
  members: GroupMember[];
  createdAt: string;
}

export class BillingEngine {
  private config: BillingEngineConfig;
  private billingHistory: BillingRecord[] = [];
  private groupSubscriptions: Map<string, GroupSubscription> = new Map();

  constructor(config?: Partial<BillingEngineConfig>) {
    this.config = {
      defaultPlanType: 'basic',
      enableAnalytics: true,
      enableABTesting: false,
      ...config,
    };
  }

  /**
   * Calculate the price for a subscription using the appropriate strategy.
   */
  calculatePrice(
    planType: PlanType,
    context: PricingContext,
    strategyOverride?: string
  ): PricingResult {
    const strategyConfig: StrategyConfig = {
      planType,
      strategyOverride,
    };

    return PricingStrategyFactory.calculatePrice(strategyConfig, context);
  }

  /**
   * Process a billing charge for a subscription.
   */
  processCharge(
    planType: PlanType,
    context: PricingContext,
    strategyOverride?: string
  ): BillingRecord {
    const result = this.calculatePrice(planType, context, strategyOverride);

    const record: BillingRecord = {
      subscriptionId: context.planId,
      subscriberAddress: context.subscriberAddress,
      planId: context.planId,
      planType,
      amount: result.price,
      currency: context.currency,
      strategyUsed: result.strategyName,
      timestamp: new Date().toISOString(),
      metadata: result.metadata,
    };

    this.billingHistory.push(record);
    return record;
  }

  /**
   * Get A/B test variants for a plan type.
   */
  getABTestVariants(planType: PlanType, basePrice: number) {
    const strategy = PricingStrategyFactory.resolveStrategy({ planType });
    return strategy.getABTestVariants(basePrice);
  }

  /**
   * Get pricing analytics for a specific strategy or all strategies.
   */
  getAnalytics(strategyName?: string): PricingAnalytics[] {
    if (strategyName) {
      const strategy = PricingStrategyFactory.getStrategy(strategyName);
      return [strategy.getAnalytics()];
    }
    return PricingStrategyFactory.getAllAnalytics();
  }

  /**
   * Get billing history for a subscriber.
   */
  getBillingHistory(subscriberAddress?: string): BillingRecord[] {
    if (subscriberAddress) {
      return this.billingHistory.filter((r) => r.subscriberAddress === subscriberAddress);
    }
    return [...this.billingHistory];
  }

  /**
   * Get available pricing strategies.
   */
  getAvailableStrategies(): string[] {
    return PricingStrategyFactory.getAvailableStrategies();
  }

  /**
   * Get the recommended strategy for a given plan type.
   */
  getRecommendedStrategy(planType: PlanType): string {
    return PricingStrategyFactory.resolveStrategy({ planType }).name;
  }

  /**
   * Create a group subscription plan.
   */
  createGroupSubscription(
    groupId: string,
    masterSubscriptionId: string,
    createdBy: string,
    planType: PlanType
  ): GroupSubscription {
    const existing = this.groupSubscriptions.get(groupId);
    if (existing) {
      throw new Error(`Group subscription ${groupId} already exists`);
    }

    const subscription: GroupSubscription = {
      groupId,
      masterSubscriptionId,
      createdBy,
      planType,
      members: [{ address: createdBy, role: 'admin', joinedAt: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    };
    this.groupSubscriptions.set(groupId, subscription);
    return subscription;
  }

  /**
   * Add a member to a group subscription.
   */
  addMemberToGroup(groupId: string, memberAddress: string, role: 'admin' | 'member' = 'member'): void {
    const group = this.getGroupSubscription(groupId);
    if (group.members.some((m) => m.address === memberAddress)) {
      throw new Error(`Member ${memberAddress} already in group ${groupId}`);
    }
    group.members.push({
      address: memberAddress,
      role,
      joinedAt: new Date().toISOString(),
    });
  }

  /**
   * Remove a member from a group subscription.
   */
  removeMemberFromGroup(groupId: string, memberAddress: string): void {
    const group = this.getGroupSubscription(groupId);
    const initialLength = group.members.length;
    group.members = group.members.filter((m) => m.address !== memberAddress);
    if (group.members.length === initialLength) {
      throw new Error(`Member ${memberAddress} not found in group ${groupId}`);
    }
  }

  /**
   * Get a group subscription by ID.
   */
  getGroupSubscription(groupId: string): GroupSubscription {
    const group = this.groupSubscriptions.get(groupId);
    if (!group) {
      throw new Error(`Group subscription ${groupId} not found`);
    }
    return group;
  }

  /**
   * Get all group subscriptions for a subscriber address.
   */
  getGroupsForSubscriber(address: string): GroupSubscription[] {
    return Array.from(this.groupSubscriptions.values()).filter((g) =>
      g.members.some((m) => m.address === address)
    );
  }

  /**
   * Get all members of a group subscription.
   */
  getGroupMembers(groupId: string): GroupMember[] {
    return this.getGroupSubscription(groupId).members;
  }
}
