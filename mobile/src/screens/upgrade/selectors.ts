/**
 * mobile/src/screens/upgrade/selectors.ts
 *
 * Memoized, deterministic business calculations for the plan upgrade flow.
 */

import type { BillingCycle, PlanTier, ProrationQuote, UpgradeFeature, UpgradePlan } from './types';

export const DEFAULT_PLANS: Record<PlanTier, UpgradePlan> = {
  starter: {
    tier: 'starter',
    name: 'Starter',
    tagline: 'Basic subscription tracking',
    monthlyPrice: 5,
    annualMonthlyEquivalent: 4, // 20% savings
    currency: 'USD',
    maxSubscriptions: 10,
    retentionDays: 90,
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    tagline: 'Advanced renewal prediction & multi-chain sync',
    monthlyPrice: 15,
    annualMonthlyEquivalent: 12, // 20% savings
    currency: 'USD',
    isPopular: true,
    badge: 'MOST POPULAR',
    maxSubscriptions: 100,
    retentionDays: 730,
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise',
    tagline: 'Dedicated accounts, custom SLA & tax compliance',
    monthlyPrice: 49,
    annualMonthlyEquivalent: 39,
    currency: 'USD',
    badge: 'BEST VALUE',
    maxSubscriptions: 10000,
    retentionDays: 3650,
  },
};

export const DEFAULT_FEATURES: UpgradeFeature[] = [
  {
    id: 'unlimited_subs',
    name: 'Up to 100 Active Subscriptions',
    description: 'Track all your personal and team software licenses',
    includedIn: ['pro', 'enterprise'],
    highlight: true,
  },
  {
    id: 'renewal_ai',
    name: 'ML Renewal Pre-Flight',
    description: 'Predict renewal risk and auto-defer churn-prone charges',
    includedIn: ['pro', 'enterprise'],
    highlight: true,
  },
  {
    id: 'tax_receipts',
    name: 'Compliant Tax Receipts & Invoicing',
    description: 'Generate international VAT/GST receipts with reverse charge',
    includedIn: ['pro', 'enterprise'],
  },
  {
    id: 'stellar_multichain',
    name: 'Multi-Chain & Soroban Sync',
    description: 'Live smart-contract indexer for non-custodial recurring payments',
    includedIn: ['pro', 'enterprise'],
  },
  {
    id: 'dedicated_sla',
    name: '99.9% Uptime Guarantee & Custom SLA',
    description: 'Priority dunning resolution and dedicated support team',
    includedIn: ['enterprise'],
  },
];

const TIER_ORDER: Record<PlanTier, number> = {
  starter: 1,
  pro: 2,
  enterprise: 3,
};

export function isUpgradeAllowed(currentTier: PlanTier, targetTier: PlanTier): boolean {
  return TIER_ORDER[targetTier] > TIER_ORDER[currentTier];
}

export function calculateAnnualSavings(
  monthlyPrice: number,
  annualMonthlyEquivalent: number
): { savingsPercent: number; annualBilledTotal: number; yearlySavings: number } {
  const annualTotal = annualMonthlyEquivalent * 12;
  const standardYearly = monthlyPrice * 12;
  const yearlySavings = Math.max(0, standardYearly - annualTotal);
  const savingsPercent = standardYearly > 0 ? Math.round((yearlySavings / standardYearly) * 100) : 0;
  return { savingsPercent, annualBilledTotal: annualTotal, yearlySavings };
}

export function calculateProrationQuote(
  currentTier: PlanTier,
  targetTier: PlanTier,
  cycle: BillingCycle,
  daysRemaining = 15,
  totalDaysInCycle = 30,
  plans: Record<PlanTier, UpgradePlan> = DEFAULT_PLANS
): ProrationQuote {
  const currentPlan = plans[currentTier];
  const targetPlan = plans[targetTier];

  const currentPrice =
    cycle === 'annual' ? currentPlan.annualMonthlyEquivalent * 12 : currentPlan.monthlyPrice;
  const targetPrice =
    cycle === 'annual' ? targetPlan.annualMonthlyEquivalent * 12 : targetPlan.monthlyPrice;

  const validDays = Math.max(0, Math.min(daysRemaining, totalDaysInCycle));
  const fractionRemaining = totalDaysInCycle > 0 ? validDays / totalDaysInCycle : 0;

  // Unused portion of current plan credited back
  const unusedCredit = Math.round(currentPrice * fractionRemaining * 100) / 100;

  // Due today: target price minus credit (floored at 0)
  const dueToday = Math.max(0, Math.round((targetPrice - unusedCredit) * 100) / 100);

  const savings = calculateAnnualSavings(
    targetPlan.monthlyPrice,
    targetPlan.annualMonthlyEquivalent
  );

  const renewalDate = new Date(
    Date.now() + (cycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .split('T')[0];

  return {
    currentTier,
    targetTier,
    billingCycle: cycle,
    daysRemaining: validDays,
    totalDaysInCycle,
    unusedCredit,
    grossTargetPrice: targetPrice,
    dueToday,
    annualSavingsPercent: cycle === 'annual' ? savings.savingsPercent : 0,
    nextBillingDate: renewalDate,
    currency: targetPlan.currency,
  };
}

export function diffPlanFeatures(
  currentTier: PlanTier,
  targetTier: PlanTier,
  features: UpgradeFeature[] = DEFAULT_FEATURES
): { unlocked: UpgradeFeature[]; retained: UpgradeFeature[] } {
  const unlocked: UpgradeFeature[] = [];
  const retained: UpgradeFeature[] = [];

  for (const f of features) {
    const inCurrent = f.includedIn.includes(currentTier);
    const inTarget = f.includedIn.includes(targetTier);

    if (inTarget && !inCurrent) {
      unlocked.push(f);
    } else if (inTarget && inCurrent) {
      retained.push(f);
    }
  }

  return { unlocked, retained };
}

export function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}
