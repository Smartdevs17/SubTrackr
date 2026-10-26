export enum CampaignType {
  WELCOME = 'welcome',
  RETENTION = 'retention',
  RE_ENGAGEMENT = 're_engagement',
  PROMOTIONAL = 'promotional',
  WINBACK = 'winback',
}

export enum CampaignStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

export enum DeliveryChannel {
  EMAIL = 'email',
  PUSH = 'push',
  IN_APP = 'in_app',
}

export enum AutomationTrigger {
  SUBSCRIPTION_CREATED = 'subscription_created',
  SUBSCRIPTION_RENEWED = 'subscription_renewed',
  SUBSCRIPTION_CANCELLED = 'subscription_cancelled',
  PAYMENT_FAILED = 'payment_failed',
  PAYMENT_SUCCESS = 'payment_success',
  INACTIVE_DAYS = 'inactive_days',
  BIRTHDAY = 'birthday',
  CART_VALUE_THRESHOLD = 'cart_value_threshold',
  REFERRAL_SIGNUP = 'referral_signup',
}

export interface CampaignContent {
  subject?: string;
  title: string;
  body: string;
  imageUrl?: string;
  ctaText?: string;
  ctaUrl?: string;
}

export interface CampaignSchedule {
  startDate: Date;
  endDate?: Date;
  sendTime?: string;
  timezone?: string;
}

export interface CampaignTarget {
  segmentIds: string[];
  subscriberFilters?: {
    minTenureDays?: number;
    maxTenureDays?: number;
    minSpend?: number;
    maxSpend?: number;
    hasFailedPayment?: boolean;
  };
}

export interface CampaignAutomation {
  trigger: AutomationTrigger;
  delayDays?: number;
  conditions?: Record<string, unknown>;
}

export interface CampaignAnalytics {
  campaignId: string;
  totalRecipients: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  convertedCount: number;
  revenue: number;
  startDate: Date;
  endDate?: Date;

  // Promotional analytics
  couponRedemptions?: number;
  totalDiscountGiven?: number;
  averageOrderValue?: number;
  conversionRate?: number;
  revenueImpact?: number;
  newCustomerAcquisitions?: number;
  /** redemptions / maxRedemptions (0 when no budget cap is set). */
  redemptionRate?: number;
  /** Share of redemptions estimated to have come from customers who would have paid full price anyway. */
  cannibalizationRate?: number;
  dailyMetrics?: {
    date: Date;
    redemptions: number;
    revenue: number;
    discountGiven: number;
  }[];
}

// New enums for promotional campaigns
export enum DiscountType {
  PERCENTAGE = 'percentage',
  FIXED_AMOUNT = 'fixed_amount',
  FREE_MONTHS = 'free_months',
  BOGO = 'bogo',
}

export enum TargetAudience {
  NEW_CUSTOMERS = 'new_customers',
  EXISTING_CUSTOMERS = 'existing_customers',
  ALL_CUSTOMERS = 'all_customers',
  SPECIFIC_SEGMENTS = 'specific_segments',
  SPECIFIC_PLANS = 'specific_plans',
}

export enum StackingRule {
  NO_STACKING = 'no_stacking',
  STACK_WITH_SEGMENT = 'stack_with_segment',
  STACK_WITH_COUPON = 'stack_with_coupon',
  FULL_STACKING = 'full_stacking',
}

// Coupon interface
export interface CouponCode {
  id: string;
  code: string;
  campaignId: string;
  maxUses: number;
  usedCount: number;
  maxUsesPerUser: number;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
}

// Promotion rule interface
export interface PromotionRule {
  discountType: DiscountType;
  discountValue: number; // percentage (0-100), fixed amount, months, or BOGO discount % on the "get" item
  appliesTo: 'plan' | 'subscription' | 'both';
  planIds?: string[];
  segmentIds?: string[];
  minPurchaseAmount?: number;
  maxDiscountAmount?: number;
  firstBillingOnly?: boolean; // Apply only to first billing cycle
  minQuantity?: number;
  maxQuantity?: number;
  /** BOGO config: buy `bogoBuyQuantity`, get `bogoGetQuantity` at `discountValue`% off. */
  bogoBuyQuantity?: number;
  bogoGetQuantity?: number;
}

/** Context describing the redemption attempt being validated. */
export interface RedemptionContext {
  userId: string;
  subscriptionId: string;
  planId?: string;
  purchaseAmount: number;
  quantity?: number;
  /** How many times this user has already redeemed this coupon. */
  userRedemptionCount: number;
  /** End of the billing period the discount would apply to — used to detect retroactive redemption. */
  billingPeriodEnd?: Date;
}

// Targeting rules interface
export interface CampaignTargeting {
  audience: TargetAudience;
  segmentIds?: string[];
  planIds?: string[];
  isNewCustomerOnly?: boolean;
  minTenureDays?: number;
  maxTenureDays?: number;
  excludedSegmentIds?: string[];
  excludedPlanIds?: string[];
}

// Stacking configuration
export interface StackingConfig {
  rule: StackingRule;
  priority: number; // Lower number = higher priority
  canStackWithSegmentDiscounts: boolean;
  canStackWithOtherCoupons: boolean;
  maxStackingDepth?: number;
}

// Campaign overlap interface
export interface CampaignOverlap {
  campaignId: string;
  overlappingCampaignId: string;
  overlapType: 'plan' | 'segment' | 'audience';
  overlapDetails: string;
  severity: 'warning' | 'error';
}

// Coupon validation result
export interface CouponValidation {
  isValid: boolean;
  campaign?: Campaign;
  coupon?: CouponCode;
  discountAmount?: number;
  finalPrice?: number;
  error?: string;
  warnings?: string[];
}

// Enhanced Campaign interface
export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  content: CampaignContent;
  target: CampaignTarget;
  schedule?: CampaignSchedule;
  automations?: CampaignAutomation[];
  channels: DeliveryChannel[];
  budget?: number;
  analytics?: CampaignAnalytics;
  createdAt: Date;
  updatedAt: Date;

  // Promotional fields
  promotionRule?: PromotionRule;
  targeting?: CampaignTargeting;
  stackingConfig?: StackingConfig;
  couponCodes?: CouponCode[];
  maxRedemptions?: number;
  currentRedemptions?: number;
}
