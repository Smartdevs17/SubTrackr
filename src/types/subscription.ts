export interface Subscription {
  id: string;
  name: string;
  description?: string;
  category: SubscriptionCategory;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  nextBillingDate: Date;
  isActive: boolean;
  isPaused?: boolean;
  pausedAt?: Date;
  pauseDurationDays?: number;
  pausedUntil?: Date;
  billingAdjustmentAmount?: number;
  /** When false, skip renewal reminders and charge alerts for this subscription */
  notificationsEnabled?: boolean;
  isCryptoEnabled: boolean;
  cryptoStreamId?: string;
  cryptoToken?: string;
  cryptoAmount?: number;
  gasBudget?: number;
  totalGasSpent?: number;
  chargeCount?: number;
  lastGasCost?: number;
  fiatPrice?: number;
  fiatCurrency?: string;
  fiatPriceUpdatedAt?: Date;
  oraclePriceDeviationBps?: number;
  groupId?: string;
  groupMemberAddress?: string;
  /** Preferred day of month for billing (1-31), used for cycle alignment */
  billingDayOfMonth?: number;
  timezone?: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum SubscriptionCategory {
  STREAMING = 'streaming',
  SOFTWARE = 'software',
  GAMING = 'gaming',
  PRODUCTIVITY = 'productivity',
  FITNESS = 'fitness',
  EDUCATION = 'education',
  FINANCE = 'finance',
  OTHER = 'other',
}

export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
  ANNUAL = 'annual',
  WEEKLY = 'weekly',
  CUSTOM = 'custom',
}

export interface AnnualBillingDiscount {
  monthlyPrice: number;
  annualPrice: number;
  savingsAmount: number;
  savingsPercentage: number;
}

export interface AnnualBillingPlan {
  id: string;
  name: string;
  monthlyRate: number;
  annualRate: number;
  discountPercentage: number;
  isAnnualOptionAvailable: boolean;
}

export enum SubscriptionTier {
  FREE = 'free',
  BASIC = 'basic',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  tier: SubscriptionTier;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  features: import('./feature').FeatureId[];
  limits: Record;
  isPopular?: boolean;
  description: string;
}

export interface SubscriptionFormData {
  name: string;
  description?: string;
  category: SubscriptionCategory;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  nextBillingDate: Date;
  notificationsEnabled?: boolean;
  isCryptoEnabled: boolean;
  cryptoToken?: string;
  cryptoAmount?: number;
  /** Preferred day of month for billing (1-31), used for cycle alignment */
  billingDayOfMonth?: number;
}

export interface SubscriptionStats {
  totalActive: number;
  totalMonthlySpend: number;
  totalYearlySpend: number;
  categoryBreakdown: Record;
  totalGasSpent?: number;
}

// ── Lifecycle history ─────────────────────────────────────────────────────────

export type SubscriptionLifecycleEventType =
  | 'created'
  | 'updated'
  | 'price_changed'
  | 'plan_changed'
  | 'activated'
  | 'paused'
  | 'resumed'
  | 'cancelled';

/** A single timestamped state transition in a subscription's lifecycle. */
export interface SubscriptionLifecycleEvent {
  id: string;
  subscriptionId: string;
  type: SubscriptionLifecycleEventType;
  occurredAt: Date;
  /** Optional human-readable context, e.g. "9.99 USD → 12.99 USD". */
  details?: string;
}

export interface CustomCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CategoryValue = SubscriptionCategory | string;

export interface CustomCategoryFormData {
  name: string;
  icon: string;
  color: string;
}