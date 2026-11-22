/**
 * Shared types for the pricing module.
 *
 * All type definitions live here so service files stay focused on
 * behaviour, and consumers get a single import location.
 */

// ── Supported billing intervals ───────────────────────────────────────────────

export type BillingInterval = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

// ── Plan templates & public tiers ─────────────────────────────────────────────

export interface PlanFeature {
  key: string;
  label: string;
  included: boolean;
  limit?: number;
}

export interface PlanTemplate {
  planId: string;
  name: string;
  description: string;
  interval: BillingInterval;
  currency: string;
  basePrice: number;
  trialDays: number;
  features: PlanFeature[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface PublicPricingTier {
  planId: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  discountPercent?: number;
  features: string[];
  isPopular?: boolean;
}

// ── Pricing strategy interface ────────────────────────────────────────────────

export interface PriceInput {
  basePrice: number;
  quantity?: number;
  usageUnits?: number;
  currency?: string;
}

export interface PriceResult {
  amount: number;
  currency: string;
  breakdown: { label: string; amount: number }[];
}

export interface IPricingStrategy {
  name: string;
  calculate(input: PriceInput): PriceResult;
}

// ── Proration ─────────────────────────────────────────────────────────────────

export interface ProrationInput {
  subscriptionId: string;
  currentPrice: number;
  newPrice: number;
  currency: string;
  /** Epoch ms when the current billing period started. */
  periodStart: number;
  /** Epoch ms when the current billing period ends. */
  periodEnd: number;
  /** Epoch ms of the plan change (defaults to now). */
  changeAt?: number;
}

export interface ProrationResult {
  subscriptionId: string;
  currency: string;
  unusedCredit: number;
  newPlanCharge: number;
  netAmount: number;
  proratedDays: number;
  totalPeriodDays: number;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

export interface PlanCacheEntry {
  plan: PlanTemplate;
  cachedAt: number;
}

export interface IPlanCache {
  get(planId: string): PlanTemplate | undefined;
  set(planId: string, plan: PlanTemplate): void;
  invalidate(planId: string): void;
  invalidateAll(): void;
  size(): number;
}

// ── Optimal pricing (ML bridge) ───────────────────────────────────────────────

export interface PricingContext {
  currentPrice: number;
  competitorAvg: number;
  currentDemand: number;
  retentionRate: number;
  sessionsPerWeek: number;
}

export interface PriceRecommendation {
  subscriptionId: string;
  optimalPrice: number;
  recommendation: 'increase' | 'decrease' | 'maintain';
  factors: {
    demandImpact: number;
    competitorBenchmark: number;
    willingnessToPay: number;
  };
}

export interface ABTestScenario {
  tier: string;
  price: number;
  reasoning: string;
}
