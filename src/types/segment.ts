import { SubscriptionCategory, BillingCycle } from './subscription';

export enum CriteriaOperator {
  EQUALS = 'eq',
  NOT_EQUALS = 'neq',
  GREATER_THAN = 'gt',
  LESS_THAN = 'lt',
  CONTAINS = 'contains',
  IN = 'in',
  STARTS_WITH = 'startsWith',
  ENDS_WITH = 'endsWith',
}

export type SegmentField =
  | 'totalMonthlySpend'
  | 'totalYearlySpend'
  | 'activeSubscriptionCount'
  | 'categories'
  | 'currencies'
  | 'billingCycles'
  | 'daysSinceLastActive'
  | 'name'
  | 'email';

export interface SegmentRule {
  id: string;
  field: SegmentField;
  operator: CriteriaOperator;
  value: any;
}

export interface SegmentPricingRule {
  discountPercentage?: number;
  fixedDiscount?: number;
  currency?: string;
  overridePrice?: number;
}

export interface Segment {
  id: string;
  name: string;
  description: string;
  criteria: SegmentRule[];
  logic: 'AND' | 'OR';
  pricingRule?: SegmentPricingRule;
  specificFeatures?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriberData {
  id: string;
  name: string;
  email: string;
  totalMonthlySpend: number;
  totalYearlySpend: number;
  activeSubscriptionCount: number;
  categories: SubscriptionCategory[];
  billingCycles: BillingCycle[];
  currencies: string[];
  daysSinceLastActive: number;
}

export interface SegmentOverlap {
  segmentIds: string[];
  subscriberCount: number;
  percentage: number;
}

export interface SegmentStats {
  subscriberCount: number;
  totalMonthlyValue: number;
  averageValuePerSubscriber: number;
  topCategories: SubscriptionCategory[];
}
