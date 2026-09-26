/**
 * chargebeeSettingsMapper.ts
 *
 * Maps Chargebee plan / subscription settings to SubTrackr's internal format.
 * This is a pure-logic service with no network calls – it accepts raw Chargebee
 * API response objects and returns normalised SubTrackr-compatible settings.
 */

import type {
  ChargbeePlan,
  ChargebeeAddon,
  ChargebeeSubscription,
  ChargebeeMapperConfig,
  MappedPlanSettings,
  MappedSubscriptionSettings,
  ChargbeePeriodUnit,
} from '../types/chargebee';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert Chargebee price (integer cents) to major currency unit.
 */
function centsToMajor(cents: number | undefined): number {
  if (cents === undefined || cents === null) return 0;
  return parseFloat((cents / 100).toFixed(2));
}

/**
 * Convert Chargebee period + period_unit to SubTrackr billing cycle.
 */
function toBillingCycle(
  period: number,
  unit: ChargbeePeriodUnit
): { billingCycle: 'monthly' | 'yearly' | 'weekly' | 'custom'; customCycleDays?: number } {
  if (unit === 'month') {
    if (period === 1) return { billingCycle: 'monthly' };
    if (period === 12) return { billingCycle: 'yearly' };
    // e.g. 3-month → custom
    return { billingCycle: 'custom', customCycleDays: period * 30 };
  }
  if (unit === 'year') {
    if (period === 1) return { billingCycle: 'yearly' };
    return { billingCycle: 'custom', customCycleDays: period * 365 };
  }
  if (unit === 'week') {
    if (period === 1) return { billingCycle: 'weekly' };
    return { billingCycle: 'custom', customCycleDays: period * 7 };
  }
  if (unit === 'day') {
    return { billingCycle: 'custom', customCycleDays: period };
  }
  return { billingCycle: 'custom', customCycleDays: 30 };
}

/**
 * Convert Chargebee trial period to days.
 */
function toTrialDays(
  period: number | undefined,
  unit: ChargbeePeriodUnit | undefined
): number | undefined {
  if (!period || !unit) return undefined;
  const map: Record<ChargbeePeriodUnit, number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };
  return period * map[unit];
}

/**
 * Convert a Unix timestamp (seconds) to a JS Date, or undefined.
 */
function fromUnix(ts: number | undefined): Date | undefined {
  if (!ts) return undefined;
  return new Date(ts * 1000);
}

// ─── ChargebeeSettingsMapper ──────────────────────────────────────────────────

export class ChargebeeSettingsMapper {
  private config: Required<ChargebeeMapperConfig>;

  constructor(config: ChargebeeMapperConfig = {}) {
    this.config = {
      defaultCurrency: config.defaultCurrency ?? 'USD',
      includeArchived: config.includeArchived ?? false,
      addonsRegistry: config.addonsRegistry ?? new Map(),
    };
  }

  // ─── Plan Mapping ───────────────────────────────────────────────────────────

  /**
   * Map a single Chargebee plan to SubTrackr plan settings.
   * Returns null for archived plans when includeArchived is false.
   */
  mapPlan(plan: ChargbeePlan): MappedPlanSettings | null {
    if (!this.config.includeArchived && plan.status === 'archived') {
      return null;
    }

    const { billingCycle, customCycleDays } = toBillingCycle(plan.period, plan.period_unit);
    const trialDays = toTrialDays(plan.trial_period, plan.trial_period_unit);
    const price = centsToMajor(plan.price);
    const currency = plan.currency_code ?? this.config.defaultCurrency;

    const addons: MappedPlanSettings['addons'] = [];
    // Plans don't have inline addons – but metadata may reference them
    // Resolve any addon IDs stored in metadata.addons array
    const metaAddonIds: string[] = [];
    if (
      plan.metadata &&
      Array.isArray((plan.metadata as Record<string, unknown>).addons)
    ) {
      metaAddonIds.push(
        ...((plan.metadata as Record<string, unknown>).addons as string[])
      );
    }
    for (const addonId of metaAddonIds) {
      const addon = this.config.addonsRegistry.get(addonId);
      if (addon) {
        addons.push({
          id: addon.id,
          name: addon.name,
          price: centsToMajor(addon.price),
        });
      }
    }

    const mapped: MappedPlanSettings = {
      name: plan.name,
      description: plan.description ?? '',
      price,
      currency,
      billingCycle,
      isActive: plan.status === 'active',
      metadata: plan.metadata ?? {},
      addons,
      sourceIds: { planId: plan.id },
    };
    if (customCycleDays !== undefined) mapped.customCycleDays = customCycleDays;
    if (trialDays !== undefined) mapped.trialDays = trialDays;

    return mapped;
  }

  /**
   * Map multiple Chargebee plans, skipping nulls (archived plans filtered out).
   */
  mapPlans(plans: ChargbeePlan[]): MappedPlanSettings[] {
    const results: MappedPlanSettings[] = [];
    for (const plan of plans) {
      const mapped = this.mapPlan(plan);
      if (mapped) results.push(mapped);
    }
    return results;
  }

  // ─── Subscription Mapping ───────────────────────────────────────────────────

  /**
   * Map a Chargebee subscription (with its resolved plan) to SubTrackr
   * subscription settings.
   */
  mapSubscription(
    subscription: ChargebeeSubscription,
    plan: ChargbeePlan
  ): MappedSubscriptionSettings {
    // Prefer subscription-level billing period over plan-level
    const period = subscription.billing_period ?? plan.period;
    const periodUnit = subscription.billing_period_unit ?? plan.period_unit;
    const { billingCycle, customCycleDays } = toBillingCycle(period, periodUnit);

    const price = centsToMajor(
      subscription.plan_amount ?? subscription.plan_unit_price ?? plan.price
    );
    const currency =
      subscription.currency_code ?? plan.currency_code ?? this.config.defaultCurrency;

    const trialDays = toTrialDays(plan.trial_period, plan.trial_period_unit);
    const nextBillingDate = fromUnix(subscription.next_billing_at);

    const isActive =
      subscription.status === 'active' ||
      subscription.status === 'in_trial' ||
      subscription.status === 'future' ||
      subscription.status === 'non_renewing';
    const isPaused = subscription.status === 'paused';

    // Resolve addons
    const addons: MappedSubscriptionSettings['addons'] = [];
    for (const a of subscription.addons ?? []) {
      const registryAddon = this.config.addonsRegistry.get(a.id);
      addons.push({
        id: a.id,
        name: registryAddon?.name ?? a.id,
        price: centsToMajor(a.unit_price ?? registryAddon?.price),
      });
    }

    const mapped: MappedSubscriptionSettings = {
      name: plan.name,
      description: plan.description ?? '',
      price,
      currency,
      billingCycle,
      isActive,
      isPaused,
      metadata: subscription.metadata ?? {},
      addons,
      sourceIds: { planId: plan.id, subscriptionId: subscription.id },
    };
    if (customCycleDays !== undefined) mapped.customCycleDays = customCycleDays;
    if (trialDays !== undefined) mapped.trialDays = trialDays;
    if (nextBillingDate !== undefined) mapped.nextBillingDate = nextBillingDate;

    return mapped;
  }

  /**
   * Map multiple subscriptions using a plan lookup map.
   * Plans keyed by plan ID.
   */
  mapSubscriptions(
    subscriptions: ChargebeeSubscription[],
    plansById: Map<string, ChargbeePlan>
  ): Array<{ subscription: MappedSubscriptionSettings; error?: never } | { subscription?: never; error: string; sourceId: string }> {
    return subscriptions.map((sub) => {
      const plan = plansById.get(sub.plan_id);
      if (!plan) {
        return { error: `Plan not found: ${sub.plan_id}`, sourceId: sub.id };
      }
      try {
        return { subscription: this.mapSubscription(sub, plan) };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
          sourceId: sub.id,
        };
      }
    });
  }

  // ─── Config helpers ─────────────────────────────────────────────────────────

  registerAddon(addon: ChargebeeAddon): void {
    this.config.addonsRegistry.set(addon.id, addon);
  }

  registerAddons(addons: ChargebeeAddon[]): void {
    for (const a of addons) this.registerAddon(a);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createChargebeeSettingsMapper(
  config?: ChargebeeMapperConfig
): ChargebeeSettingsMapper {
  return new ChargebeeSettingsMapper(config);
}
