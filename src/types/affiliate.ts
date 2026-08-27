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
  isClawbacked?: boolean;
}

export interface PayoutRecord {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed';
  requestedAt: Date;
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
  // Extended fields
  referralCode?: string;
  referralLink?: string;
  clicksCount?: number;
  fraudRiskScore?: number; // 0 to 100
  fraudStatus?: 'safe' | 'suspicious' | 'flagged';
  payoutHistory?: PayoutRecord[];
}

export interface AffiliateProgram {
  id: string;
  name: string;
  description: string;
  commissionConfig: CommissionConfig;
  attributionWindowDays: number;
  isActive: boolean;
  attributionModel?: 'first-touch' | 'last-touch' | 'linear';
}

export interface AffiliateMetrics {
  totalReferrals: number;
  activeReferrals: number;
  totalEarnings: number;
  pendingPayout: number;
  conversionRate: number;
  totalClicks?: number;
}
