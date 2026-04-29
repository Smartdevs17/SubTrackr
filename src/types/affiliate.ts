export enum CommissionType {
  PERCENTAGE = 'percentage',
  FLAT = 'flat',
  TIERED = 'tiered',
}

export enum AffiliateStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  SUSPENDED = 'suspended',
}

export interface CommissionConfig {
  type: CommissionType;
  rate: number;
  tierThresholds?: number[];
  tierRates?: number[];
}

export interface Commission {
  id: string;
  affiliateId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'approved' | 'paid';
  createdAt: Date;
  paidAt?: Date;
}

export interface Affiliate {
  id: string;
  referrerAddress: string;
  programId: string;
  commissionRate: number;
  paymentThreshold: number;
  status: AffiliateStatus;
  totalReferrals: number;
  totalEarnings: number;
  pendingPayout: number;
  createdAt: Date;
}

export interface AffiliateProgram {
  id: string;
  name: string;
  description: string;
  commissionConfig: CommissionConfig;
  attributionWindowDays: number;
  isActive: boolean;
}

export interface AffiliateMetrics {
  totalReferrals: number;
  activeReferrals: number;
  totalEarnings: number;
  pendingPayout: number;
  conversionRate: number;
}