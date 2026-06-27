/**
 * In-memory store for public CDN-cacheable resources.
 * Mutations write here so subsequent GETs reflect updates after CDN purge.
 */

import type { PublicPlan } from '../controller/plansController';
import type { PublicPricingTier } from '../controller/pricingController';

const DEFAULT_PLANS: PublicPlan[] = [
  { id: 'free', name: 'Free', price: 0, currency: 'USD', billingCycle: 'monthly' },
  { id: 'basic', name: 'Basic', price: 4.99, currency: 'USD', billingCycle: 'monthly' },
  { id: 'premium', name: 'Premium', price: 9.99, currency: 'USD', billingCycle: 'monthly' },
  { id: 'enterprise', name: 'Enterprise', price: 29.99, currency: 'USD', billingCycle: 'monthly' },
];

const DEFAULT_PRICING: PublicPricingTier[] = [
  { planId: 'free', monthlyPrice: 0, yearlyPrice: 0, currency: 'USD' },
  { planId: 'basic', monthlyPrice: 4.99, yearlyPrice: 49.99, currency: 'USD', discountPercent: 17 },
  { planId: 'premium', monthlyPrice: 9.99, yearlyPrice: 99.99, currency: 'USD', discountPercent: 17 },
  { planId: 'enterprise', monthlyPrice: 29.99, yearlyPrice: 299.99, currency: 'USD', discountPercent: 17 },
];

const DEFAULT_PUBLIC_CONFIG: Record<string, unknown> = {
  'app/version': { minSupported: '1.0.0', latest: '1.0.0' },
  'app/support': { email: 'support@subtrackr.app', docsUrl: 'https://docs.subtrackr.app' },
  'billing/currencies': { supported: ['USD', 'EUR', 'GBP'] },
  'onboarding/steps': { count: 4, skippable: true },
};

export class PublicDataStore {
  private plans = new Map<string, PublicPlan>();
  private pricing = new Map<string, PublicPricingTier>();
  private publicConfig = new Map<string, unknown>();
  private featureOverrides = new Map<string, boolean>();

  constructor(seedDefaults = true) {
    if (seedDefaults) {
      this.reset();
    }
  }

  reset(): void {
    this.plans.clear();
    this.pricing.clear();
    this.publicConfig.clear();
    this.featureOverrides.clear();

    for (const plan of DEFAULT_PLANS) {
      this.plans.set(plan.id, { ...plan });
    }
    for (const tier of DEFAULT_PRICING) {
      this.pricing.set(tier.planId, { ...tier });
    }
    for (const [key, value] of Object.entries(DEFAULT_PUBLIC_CONFIG)) {
      this.publicConfig.set(key, JSON.parse(JSON.stringify(value)));
    }
  }

  listPlans(): PublicPlan[] {
    return Array.from(this.plans.values());
  }

  getPlan(id: string): PublicPlan | undefined {
    return this.plans.get(id);
  }

  updatePlan(id: string, patch: Partial<Omit<PublicPlan, 'id'>>): PublicPlan | null {
    const existing = this.plans.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, id };
    this.plans.set(id, updated);
    return updated;
  }

  listPricing(): PublicPricingTier[] {
    return Array.from(this.pricing.values());
  }

  getPricing(planId: string): PublicPricingTier | undefined {
    return this.pricing.get(planId);
  }

  updatePricing(planId: string, patch: Partial<Omit<PublicPricingTier, 'planId'>>): PublicPricingTier | null {
    const existing = this.pricing.get(planId);
    if (!existing) return null;
    const updated = { ...existing, ...patch, planId };
    this.pricing.set(planId, updated);
    return updated;
  }

  listPublicConfig(): Record<string, unknown> {
    return Object.fromEntries(this.publicConfig.entries());
  }

  getPublicConfigEntry(key: string): unknown {
    return this.publicConfig.has(key) ? this.publicConfig.get(key) : null;
  }

  updatePublicConfig(key: string, value: unknown): void {
    this.publicConfig.set(key, value);
  }

  getFeatureOverride(featureId: string): boolean | undefined {
    return this.featureOverrides.get(featureId);
  }

  setFeatureOverride(featureId: string, enabled: boolean): void {
    this.featureOverrides.set(featureId, enabled);
  }
}

export const publicDataStore = new PublicDataStore();
