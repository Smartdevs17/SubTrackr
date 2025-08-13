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
  isCryptoEnabled: boolean;
  cryptoStreamId?: string;
  cryptoToken?: string;
  cryptoAmount?: number;
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

export interface SubscriptionFormData {
  name: string;
  description?: string;
  category: SubscriptionCategory;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  nextBillingDate: Date;
  isCryptoEnabled: boolean;
  cryptoToken?: string;
  cryptoAmount?: number;
}

export interface SubscriptionStats {
  totalActive: number;
  totalMonthlySpend: number;
  totalYearlySpend: number;
  categoryBreakdown: Record<SubscriptionCategory, number>;
}
