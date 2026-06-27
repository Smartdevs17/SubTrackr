import { Subscription } from '../../../src/types/subscription';
import { Invoice, InvoiceConfig, InvoicePeriod } from '../../../src/types/invoice';
import { ConsolidationGroup } from '../../../src/types/billingAlignment';
import { buildConsolidatedInvoice } from '../../../src/utils/invoice';
import { groupForConsolidation } from '../../../src/utils/billingAlignment';

/**
 * Merges subscriptions that share a billing date into a single invoice.
 * Also decides whether a newly-purchased subscription should be
 * auto-consolidated with the subscriber's existing billing date.
 */
export class ConsolidationEngine {
  /** Groups of 2+ active, paid subscriptions sharing the same billing date. */
  findConsolidationGroups(subscriptions: Subscription[]): ConsolidationGroup[] {
    return groupForConsolidation(subscriptions);
  }

  consolidate(
    subscriptions: Subscription[],
    sequence: number,
    period: InvoicePeriod,
    config?: InvoiceConfig
  ): Invoice {
    return buildConsolidatedInvoice(subscriptions, sequence, period, config);
  }

  /**
   * Auto-consolidation for new multi-subscription purchases: a newly added
   * subscription should adopt the subscriber's existing shared billing date
   * (if one exists) rather than starting its own cycle.
   */
  shouldAutoConsolidate(existingSubscriptions: Subscription[], newSubscription: Subscription): boolean {
    if (newSubscription.price <= 0) return false;
    const groups = this.findConsolidationGroups(existingSubscriptions);
    return groups.length > 0;
  }

  /** Returns the shared billing date a new subscription should align to, if any. */
  getAutoConsolidationTarget(existingSubscriptions: Subscription[]): Date | null {
    const groups = this.findConsolidationGroups(existingSubscriptions);
    if (groups.length === 0) return null;
    // Prefer the group with the most members as the dominant billing date.
    const dominant = [...groups].sort((a, b) => b.subscriptionIds.length - a.subscriptionIds.length)[0];
    return new Date(dominant.billingDateKey);
  }
}

export const consolidationEngine = new ConsolidationEngine();
