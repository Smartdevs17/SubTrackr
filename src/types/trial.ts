export enum TrialDuration {
  SEVEN_DAYS = 'seven_days',
  FOURTEEN_DAYS = 'fourteen_days',
  TWENTY_ONE_DAYS = 'twenty_one_days',
  THIRTY_DAYS = 'thirty_days',
}

export enum TrialFeatureAccess {
  FULL = 'full',
  LIMITED = 'limited',
}

export enum PaymentRequirement {
  REQUIRED = 'required',
  OPTIONAL = 'optional',
  DEFERRED = 'deferred',
}

export enum TrialStatus {
  ACTIVE = 'active',
  CONVERTED = 'converted',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export interface ABTestVariant {
  name: string;
  weight: number;
  config: Record<string, any>;
}

export interface TrialConfig {
  id: string;
  subscriptionId: string;
  duration: TrialDuration;
  featureAccess: TrialFeatureAccess;
  paymentRequirement: PaymentRequirement;
  abTestId?: string;
  status: TrialStatus;
  startDate?: Date;
  endDate?: Date;
  convertedAt?: Date;
  reminderScheduleId?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ABTestAssignment {
  id: string;
  abTestId: string;
  userId: string;
  variantName: string;
  assignedAt: Date;
  cohort?: string;
}

export interface ConversionFunnelEvent {
  id: string;
  trialConfigId: string;
  eventType: 'trial_started' | 'feature_accessed' | 'reminder_sent' | 'dashboard_visited' | 'payment_clicked' | 'payment_completed' | 'trial_expired' | 'trial_cancelled' | 'trial_converted';
  userId: string;
  variantName?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface TrialReminderSchedule {
  id: string;
  trialConfigId: string;
  userId: string;
  reminders: TrialReminder[];
  createdAt: Date;
}

export interface TrialReminder {
  id: string;
  type: 'D-3' | 'D-1' | 'D-DAY';
  scheduledAt: Date;
  sent: boolean;
  sentAt?: Date;
  message?: string;
}

export interface TrialStats {
  totalTrials: number;
  activeTrials: number;
  convertedTrials: number;
  expiredTrials: number;
  cancelledTrials: number;
  conversionRate: number;
  avgTimeToConvert: number;
  variantStats: Record<string, {
    trials: number;
    conversions: number;
    conversionRate: number;
  }>;
}
