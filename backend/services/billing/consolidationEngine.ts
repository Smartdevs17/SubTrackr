import { Subscription } from '../../../src/types/subscription';
import { Invoice, InvoiceConfig, InvoicePeriod } from '../../../src/types/invoice';
import { ConsolidationGroup } from '../../../src/types/billingAlignment';
import { buildConsolidatedInvoice, buildInvoice } from '../../../src/utils/invoice';
import { groupForConsolidation } from '../../../src/utils/billingAlignment';

export interface MerchantConsolidationSetting {
  merchantId: string;
  enabled: boolean;
  updatedAt: Date;
}

export interface CycleInvoicesInput {
  merchantId: string;
  subscriptions: Subscription[];
  sequence: number;
  period: InvoicePeriod;
  config?: InvoiceConfig;
}

/**
 * Merges subscriptions that share a billing date into a single invoice.
 * Also decides whether a newly-purchased subscription should be
 * auto-consolidated with the subscriber's existing billing date.
 *
 * Group plan support: Subscriptions may include a `groupPlanId` and
 * `memberIds`. When a new subscription is added to an existing group plan,
 * it should consolidate with the group's shared billing date. This engine
 * ensures group plans are aligned and provides member management helpers
 * for billing purposes.
 */
export class ConsolidationEngine {
  private merchantSettings = new Map<string, MerchantConsolidationSetting>();

  /**
   * Opt a merchant in or out of monthly invoice consolidation.
   *
   * Default is opt-out (`false`) so existing merchants keep one invoice per
   * charge until they explicitly enable consolidation.
   */
  setMerchantConsolidation(
    merchantId: string,
    enabled: boolean,
    now: Date = new Date()
  ): MerchantConsolidationSetting {
    if (typeof merchantId !== 'string' || merchantId.trim().length === 0) {
      throw new Error('merchantId is required');
    }
    const setting: MerchantConsolidationSetting = {
      merchantId,
      enabled: Boolean(enabled),
      updatedAt: new Date(now),
    };
    this.merchantSettings.set(merchantId, setting);
    return { ...setting, updatedAt: new Date(setting.updatedAt) };
  }

  getMerchantConsolidation(
    merchantId: string
  ): MerchantConsolidationSetting | undefined {
    const setting = this.merchantSettings.get(merchantId);
    return setting
      ? { ...setting, updatedAt: new Date(setting.updatedAt) }
      : undefined;
  }

  isMerchantConsolidationEnabled(merchantId: string): boolean {
    return this.merchantSettings.get(merchantId)?.enabled ?? false;
  }

  clearMerchantConsolidation(merchantId: string): boolean {
    return this.merchantSettings.delete(merchantId);
  }

  /**
   * Generates the invoice(s) for one merchant billing cycle.
   *
   * - Opted-out merchants keep one invoice per active paid subscription.
   * - Opted-in merchants receive one consolidated invoice containing every
   *   subscription as a separate line item.
   * - Inactive and free subscriptions are skipped in both modes.
   * - A single billable subscription always produces a normal invoice.
   */
  generateCycleInvoices(input: CycleInvoicesInput): Invoice[] {
    const billable = input.subscriptions.filter(
      (subscription) => subscription.isActive && subscription.price > 0
    );

    if (billable.length === 0) return [];

    if (billable.length === 1) {
      return [
        buildInvoice(billable[0], input.sequence, input.period, input.config),
      ];
    }

    if (!this.isMerchantConsolidationEnabled(input.merchantId)) {
      return billable.map((subscription, index) =>
        buildInvoice(
          subscription,
          input.sequence + index,
          input.period,
          input.config
        )
      );
    }

    return [
      buildConsolidatedInvoice(
        billable,
        input.sequence,
        input.period,
        input.config
      ),
    ];
  }

  /**
   * Groups of 2+ active, paid subscriptions sharing the same billing date.
   * Group plan subscriptions are grouped by their billing date as well.
   */
  findConsolidationGroups(subscriptions: Subscription[]): ConsolidationGroup[] {
    return groupForConsolidation(subscriptions);
  }

  /**
   * Builds a single consolidated invoice for the given subscriptions.
   * For group plans, the invoice includes the plan's pricing and member
   * breakdown as provided by the billing alignment utility.
   */
  consolidate(
    subscriptions: Subscription[],
    sequence: number,
    period: InvoicePeriod,
    config?: InvoiceConfig
  ): Invoice {
    return buildConsolidatedInvoice(subscriptions, sequence, period, config);
  }

  /**
   * Determines if a newly purchased subscription should be auto-consolidated
   * with the subscriber's existing billing date.
   *
   * A subscription should be consolidated if:
   * - It has a positive price
   * - There are existing consolidation groups
   * - It is part of a group plan that already exists in the subscription list
   */
  shouldAutoConsolidate(existingSubscriptions: Subscription[], newSubscription: Subscription): boolean {
    if (newSubscription.price <= 0) return false;

    const groups = this.findConsolidationGroups(existingSubscriptions);
    if (groups.length === 0) return false;

    // If the new subscription is a group plan, ensure its group already exists.
    if (this.isGroupPlan(newSubscription)) {
      return existingSubscriptions.some(sub =>
        (sub as any).groupPlanId === (newSubscription as any).groupPlanId && sub.id !== newSubscription.id
      );
    }

    // Regular subscriptions consolidate if any group exists.
    return true;
  }

  /**
   * Returns the shared billing date a new subscription should align to, if any.
   *
   * For group plans, the target is the billing date of the group the
   * subscription belongs to (if already active). Otherwise, the dominant
   * (largest) consolidation group is used.
   */
  getAutoConsolidationTarget(
    existingSubscriptions: Subscription[],
    newSubscription?: Subscription
  ): Date | null {
    const groups = this.findConsolidationGroups(existingSubscriptions);
    if (groups.length === 0) return null;

    let chosenGroup: ConsolidationGroup | undefined;

    // If a group plan is being added, try to align with its group.
    if (newSubscription && this.isGroupPlan(newSubscription)) {
      const matchingGroup = groups.find(group =>
        group.subscriptionIds.some(id => {
          const sub = existingSubscriptions.find(s => s.id === id);
          return sub && (sub as any).groupPlanId === (newSubscription as any).groupPlanId;
        })
      );
      if (matchingGroup) {
        chosenGroup = matchingGroup;
      }
    }

    // Fall back to the dominant (largest) group.
    if (!chosenGroup) {
      chosenGroup = [...groups].sort(
        (a, b) => b.subscriptionIds.length - a.subscriptionIds.length
      )[0];
    }

    const date = new Date(chosenGroup.billingDateKey);
    if (isNaN(date.getTime())) {
      // Invalid date key; return null to be safe.
      return null;
    }
    return date;
  }

  /**
   * Checks whether a subscription is a group plan by looking for a
   * `groupPlanId` and a `memberIds` array.
   */
  isGroupPlan(subscription: Subscription): boolean {
    return Boolean(
      subscription &&
      typeof (subscription as any).groupPlanId === 'string' &&
      Array.isArray((subscription as any).memberIds)
    );
  }

  /**
   * Adds a member to a group plan subscription. Returns a new subscription
   * object with updated memberIds.
   */
  addMember(subscription: Subscription, memberId: string): Subscription {
    if (!this.isGroupPlan(subscription)) {
      throw new Error('Cannot add member to a non-group-plan subscription.');
    }
    const memberIds = [...(subscription as any).memberIds];
    if (!memberIds.includes(memberId)) {
      memberIds.push(memberId);
    }
    return { ...subscription, memberIds };
  }

  /**
   * Removes a member from a group plan subscription. Returns a new subscription
   * object with updated memberIds.
   */
  removeMember(subscription: Subscription, memberId: string): Subscription {
    if (!this.isGroupPlan(subscription)) {
      throw new Error('Cannot remove member from a non-group-plan subscription.');
    }
    const memberIds = (subscription as any).memberIds.filter((id: string) => id !== memberId);
    return { ...subscription, memberIds };
  }
}

export const consolidationEngine = new ConsolidationEngine();
