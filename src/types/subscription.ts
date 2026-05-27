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
  /** Oracle-sourced fiat equivalent price for display purposes */
  fiatPrice?: number;
  fiatCurrency?: string;
  fiatPriceUpdatedAt?: Date;
  oraclePriceDeviationBps?: number;
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
  WEEKLY = 'weekly',
  CUSTOM = 'custom',
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
  features: import('./feature').FeatureId[]; // Feature IDs included in this plan
  limits: Record<string, number>; // Feature limits (e.g., { 'max_subscriptions': 10 })
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
}

export interface SubscriptionStats {
  totalActive: number;
  totalMonthlySpend: number;
  totalYearlySpend: number;
  categoryBreakdown: Record<SubscriptionCategory, number>;
  totalGasSpent?: number;
  totalFiatMonthlySpend?: number;
  fiatCurrency?: string;
}
