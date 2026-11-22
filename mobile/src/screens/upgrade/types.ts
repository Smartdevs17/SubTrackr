/**
 * mobile/src/screens/upgrade/types.ts
 *
 * Types for the in-app subscription plan upgrade surface.
 */

export type PlanTier = 'starter' | 'pro' | 'enterprise';

export type BillingCycle = 'monthly' | 'annual';

export type UpgradeStep = 'select' | 'confirm' | 'processing' | 'success' | 'error';

export interface UpgradeFeature {
  id: string;
  name: string;
  description: string;
  includedIn: PlanTier[];
  highlight?: boolean;
}

export interface UpgradePlan {
  tier: PlanTier;
  name: string;
  tagline: string;
  monthlyPrice: number;
  annualMonthlyEquivalent: number; // e.g. $16/mo billed annually
  currency: string;
  isPopular?: boolean;
  badge?: string;
  maxSubscriptions: number;
  retentionDays: number;
}

export interface ProrationQuote {
  currentTier: PlanTier;
  targetTier: PlanTier;
  billingCycle: BillingCycle;
  daysRemaining: number;
  totalDaysInCycle: number;
  unusedCredit: number;
  grossTargetPrice: number;
  dueToday: number;
  annualSavingsPercent: number;
  nextBillingDate: string;
  currency: string;
}

export interface UpgradeMetrics {
  onView?: (tier: PlanTier) => void;
  onSelectTier?: (tier: PlanTier) => void;
  onToggleCycle?: (cycle: BillingCycle) => void;
  onUpgradeStart?: (targetTier: PlanTier, dueToday: number) => void;
  onUpgradeSuccess?: (targetTier: PlanTier) => void;
  onUpgradeFailure?: (error: string) => void;
}

export interface UpgradeScreenProps {
  currentTier?: PlanTier;
  currentBillingCycle?: BillingCycle;
  daysRemainingInPeriod?: number;
  totalDaysInPeriod?: number;
  onCompleteUpgrade?: (targetTier: PlanTier, cycle: BillingCycle) => Promise<void>;
  onBack?: () => void;
  metrics?: UpgradeMetrics;
  testID?: string;
}
