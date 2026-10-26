export enum HealthScoreStatus {
  GREEN = 'green',
  YELLOW = 'yellow',
  RED = 'red',
  NEUTRAL = 'neutral',
}

export enum HealthScoreFactor {
  LOGIN_FREQUENCY = 'login_frequency',
  FEATURE_USAGE = 'feature_usage',
  PAYMENT_SUCCESS_RATE = 'payment_success_rate',
  SUPPORT_TICKETS = 'support_tickets',
  NPS_RESPONSE = 'nps_response',
}

export enum InterventionType {
  PRIORITY_EMAIL = 'priority_email',
  ACCOUNT_MANAGER_ALERT = 'account_manager_alert',
  DISCOUNT_OFFER = 'discount_offer',
}

export interface HealthScoreWeights {
  loginFrequency: number;
  featureUsage: number;
  paymentSuccessRate: number;
  supportTickets: number;
  npsResponse: number;
}

export interface HealthScoreBreakdown {
  overall: number;
  loginFrequency: number;
  featureUsage: number;
  paymentSuccessRate: number;
  supportTickets: number;
  npsResponse: number;
}

export interface HealthScore {
  id: string;
  subscriptionId: string;
  userId: string;
  score: number;
  status: HealthScoreStatus;
  breakdown: HealthScoreBreakdown;
  weights: HealthScoreWeights;
  manualOverride?: number;
  manualOverrideReason?: string;
  manualOverrideBy?: string;
  manualOverrideAt?: Date;
  trend: 'improving' | 'stable' | 'declining';
  calculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface HealthScoreHistory {
  id: string;
  healthScoreId: string;
  score: number;
  status: HealthScoreStatus;
  calculatedAt: Date;
}

export interface Intervention {
  id: string;
  healthScoreId: string;
  type: InterventionType;
  triggeredAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  metadata?: Record<string, unknown>;
}

export const DEFAULT_WEIGHTS: HealthScoreWeights = {
  loginFrequency: 0.2,
  featureUsage: 0.25,
  paymentSuccessRate: 0.3,
  supportTickets: 0.15,
  npsResponse: 0.1,
};

export const SCORE_THRESHOLDS = {
  GREEN_MIN: 80,
  YELLOW_MIN: 50,
} as const;
