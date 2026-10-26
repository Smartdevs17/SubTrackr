export interface SubscriptionPlan {
  id: string;
  name: string;
  tier: PlanTier;
  description: string;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  features: PlanFeature[];
  limits: PlanLimits;
  isPopular: boolean;
  isRecommended: boolean;
  discount?: PlanDiscount;
  trialDays?: number;
  createdAt: Date;
  updatedAt: Date;
}

export enum PlanTier {
  FREE = 'free',
  BASIC = 'basic',
  STANDARD = 'standard',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
}

export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
  QUARTERLY = 'quarterly',
}

export interface PlanFeature {
  id: string;
  name: string;
  description: string;
  included: boolean;
  limit?: number;
  unit?: string;
}

export interface PlanLimits {
  subscriptions: number;
  users?: number;
  storage?: number;
  apiCalls?: number;
}

export interface PlanDiscount {
  percentage: number;
  validUntil?: Date;
  code?: string;
}

export interface PlanComparison {
  plans: SubscriptionPlan[];
  comparisonMatrix: ComparisonRow[];
  recommendations: PlanRecommendation[];
}

export interface ComparisonRow {
  category: string;
  features: Array<{
    name: string;
    values: Record<string, string | boolean | number>;
  }>;
}

export interface PlanRecommendation {
  planId: string;
  reason: string;
  savings?: number;
  confidence: number;
}

export interface PlanSwitchRequest {
  currentPlanId: string;
  targetPlanId: string;
  userId: string;
  subscriptionId?: string;
  effectiveDate?: Date;
  prorated: boolean;
}

export interface PlanSwitchResponse {
  success: boolean;
  switchId: string;
  currentPlan: SubscriptionPlan;
  newPlan: SubscriptionPlan;
  effectiveDate: Date;
  prorationCredit?: number;
  prorationCharge?: number;
  message: string;
}

export interface PlanSwitchHistory {
  id: string;
  userId: string;
  fromPlanId: string;
  toPlanId: string;
  fromPlanName: string;
  toPlanName: string;
  reason?: string;
  effectiveDate: Date;
  prorationAmount?: number;
  status: SwitchStatus;
  createdAt: Date;
}

export enum SwitchStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface PlanAnalytics {
  totalPlans: number;
  activeSubscriptionsByPlan: Record<string, number>;
  revenueByPlan: Record<string, number>;
  switchesLastMonth: number;
  popularPlan: string;
  conversionRate: number;
  churRate: number;
}

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  current: boolean;
}

export interface PlanSwitchWizardState {
  currentStep: number;
  steps: WizardStep[];
  selectedPlan?: SubscriptionPlan;
  currentPlan?: SubscriptionPlan;
  comparison?: PlanComparison;
  switchRequest?: PlanSwitchRequest;
  isProcessing: boolean;
}
