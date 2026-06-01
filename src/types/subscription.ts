export interface Subscription {
  id: string;
  name: string;
  description?: string;
  /** Optional remote URL for the subscription's icon image */
  iconUrl?: string;
  category: SubscriptionCategory;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  nextBillingDate: Date;
  isActive: boolean;
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
}

export interface SubscriptionStats {
  totalActive: number;
  totalMonthlySpend: number;
  totalYearlySpend: number;
  categoryBreakdown: Record;
  totalGasSpent?: number;
  totalFiatMonthlySpend?: number;
  fiatCurrency?: string;
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