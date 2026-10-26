import { AnnualBillingDiscount, AnnualBillingPlan, BillingCycle } from '../types/subscription';

/**
 * Calculates annual savings amount and percentage given monthly and annual prices.
 * Returns 0 savings if annualPrice is invalid or higher than total 12-month cost.
 */
export function calculateAnnualDiscount(
  monthlyPrice: number,
  annualPrice: number
): AnnualBillingDiscount {
  const annualFromMonthly = monthlyPrice * 12;
  const savingsAmount = Math.max(0, Math.round((annualFromMonthly - annualPrice) * 100) / 100);
  const savingsPercentage =
    annualFromMonthly > 0 ? Math.max(0, Math.round((savingsAmount / annualFromMonthly) * 100)) : 0;

  return {
    monthlyPrice,
    annualPrice,
    savingsAmount,
    savingsPercentage,
  };
}

/**
 * Converts a monthly rate into an annual billing rate applying an optional discount percentage.
 * Default discount is 15% if omitted.
 */
export function convertMonthlyToAnnualRate(
  monthlyRate: number,
  discountPercentage: number = 15
): number {
  if (monthlyRate <= 0) return 0;
  const fullYearRate = monthlyRate * 12;
  const discountedRate = fullYearRate * (1 - Math.min(100, Math.max(0, discountPercentage)) / 100);
  return Math.round(discountedRate * 100) / 100;
}

/**
 * Normalizes any annual or yearly billing cycle string to BillingCycle.ANNUAL.
 */
export function isAnnualBillingCycle(cycle: BillingCycle | string): boolean {
  return (
    cycle === BillingCycle.ANNUAL ||
    cycle === BillingCycle.YEARLY ||
    cycle === 'annual' ||
    cycle === 'yearly'
  );
}

/**
 * Builds an AnnualBillingPlan object with full monthly & annual breakdown details.
 */
export function createAnnualBillingPlan(
  id: string,
  name: string,
  monthlyRate: number,
  discountPercentage: number = 15
): AnnualBillingPlan {
  const annualRate = convertMonthlyToAnnualRate(monthlyRate, discountPercentage);
  return {
    id,
    name,
    monthlyRate,
    annualRate,
    discountPercentage,
    isAnnualOptionAvailable: true,
  };
}
