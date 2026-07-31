export enum PartnerStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  SUSPENDED = 'suspended',
  REJECTED = 'rejected',
}

export enum SplitType {
  PERCENTAGE = 'percentage',
  FIXED_AMOUNT = 'fixed_amount',
  TIERED_WATERFALL = 'tiered_waterfall',
}

export enum PartnerPayoutSchedule {
  INSTANT = 'instant',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  THRESHOLD = 'threshold',
}

export interface SplitTier {
  id: string;
  name: string;
  threshold: number;
  splitPercentage: number;
  fixedAmount?: number;
  priority: number;
}

export interface SplitConfiguration {
  id: string;
  subscriptionId: string;
  partnerId: string;
  splitType: SplitType;
  payoutSchedule: PartnerPayoutSchedule;
  percentage?: number;
  fixedAmount?: number;
  currency: string;
  minPayoutThreshold?: number;
  maxPayoutPerPeriod?: number;
  tiers?: SplitTier[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayoutRecord {
  id: string;
  partnerId: string;
  splitConfigurationId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  grossAmount: number;
  platformFee: number;
  netAmount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  transactionHash?: string;
  executedAt?: Date;
  settledAt?: Date;
  periodStart: Date;
  periodEnd: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface Partner {
  id: string;
  name: string;
  email: string;
  company?: string;
  status: PartnerStatus;
  paymentAddress?: string;
  taxId?: string;
  contractUrl?: string;
  onboardedAt: Date;
  verifiedAt?: Date;
  suspendedAt?: Date;
  rejectionReason?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SplitExecution {
  id: string;
  splitConfigurationId: string;
  subscriptionId: string;
  transactionId: string;
  grossAmount: number;
  splits: {
    partnerId: string;
    amount: number;
    percentage: number;
  }[];
  platformRevenue: number;
  executedAt: Date;
  status: 'pending' | 'completed' | 'failed';
  error?: string;
}

export interface PartnerEarnings {
  partnerId: string;
  totalEarnings: number;
  pendingPayouts: number;
  completedPayouts: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  bySubscription: Record<string, number>;
}
