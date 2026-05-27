export type DunningStage = 'retry' | 'warn' | 'suspend' | 'cancel';

export interface DunningConfiguration {
  planId: string;
  stages: DunningStageConfig[];
  maxRetries: number;
  retryIntervalHours: number;
  warnAfterFailures: number;
  suspendAfterDays: number;
  cancelAfterDays: number;
  communicationChannels: ('email' | 'push' | 'in_app')[];
}

export interface DunningStageConfig {
  stage: DunningStage;
  delayHours: number;
  maxAttempts: number;
  templateId: string;
}

export interface DunningEntry {
  id: string;
  subscriptionId: string;
  subscriberId: string;
  merchantId: string;
  planId: string;
  currentStage: DunningStage;
  failedAttempts: number;
  totalFailedCharges: number;
  firstFailureAt: number;
  lastFailureAt: number;
  lastAttemptAt: number;
  nextActionAt: number;
  isPaused: boolean;
  communicationLog: DunningCommunication[];
  createdAt: number;
  updatedAt: number;
}

export interface DunningCommunication {
  id: string;
  stage: DunningStage;
  channel: 'email' | 'push' | 'in_app';
  templateId: string;
  sentAt: number;
  status: 'sent' | 'failed' | 'opened' | 'clicked';
  metadata?: Record<string, string>;
}

export interface DunningCommunicationTemplate {
  id: string;
  stage: DunningStage;
  subject: string;
  body: string;
  pushTitle: string;
  pushBody: string;
  actionLabel: string;
  actionUrl: string;
}

export interface DunningAnalytics {
  totalActiveDunning: number;
  stageBreakdown: Record<DunningStage, number>;
  recoveryRate: number;
  totalRecovered: number;
  totalLost: number;
  averageDaysToRecovery: number;
  stageSuccessRates: Record<DunningStage, number>;
}

export const DEFAULT_DUNNING_STAGES: DunningStageConfig[] = [
  { stage: 'retry', delayHours: 1, maxAttempts: 3, templateId: 'payment_retry' },
  { stage: 'warn', delayHours: 24, maxAttempts: 2, templateId: 'payment_warning' },
  { stage: 'suspend', delayHours: 72, maxAttempts: 1, templateId: 'service_suspension' },
  { stage: 'cancel', delayHours: 168, maxAttempts: 1, templateId: 'subscription_cancellation' },
];

export const DUNNING_TEMPLATES: DunningCommunicationTemplate[] = [
  {
    id: 'payment_retry',
    stage: 'retry',
    subject: 'Payment retry initiated for {subscription_name}',
    body: 'We were unable to process your payment of {amount} {currency} for {subscription_name}. We will automatically retry up to {max_retries} times. No action needed at this time.',
    pushTitle: 'Payment retry: {subscription_name}',
    pushBody: 'Retrying payment of {amount} {currency}. No action needed.',
    actionLabel: 'View subscription',
    actionUrl: '/subscription/{subscription_id}',
  },
  {
    id: 'payment_warning',
    stage: 'warn',
    subject: 'Action needed: {subscription_name} payment failing',
    body: 'We have been unable to process your payment of {amount} {currency} for {subscription_name} after {attempts} attempts. Please update your payment method to avoid service interruption.',
    pushTitle: 'Payment failing: {subscription_name}',
    pushBody: '{attempts} attempts failed. Update payment method to avoid interruption.',
    actionLabel: 'Update payment method',
    actionUrl: '/subscription/{subscription_id}/payment',
  },
  {
    id: 'service_suspension',
    stage: 'suspend',
    subject: '{subscription_name} has been suspended',
    body: 'Due to continued payment failures, your subscription to {subscription_name} has been temporarily suspended. You can restore access by updating your payment method.',
    pushTitle: '{subscription_name} suspended',
    pushBody: 'Update payment method to restore service.',
    actionLabel: 'Restore subscription',
    actionUrl: '/subscription/{subscription_id}/restore',
  },
  {
    id: 'subscription_cancellation',
    stage: 'cancel',
    subject: '{subscription_name} has been cancelled',
    body: 'Your subscription to {subscription_name} has been cancelled due to unresolved payment issues. Your data will be retained for {retention_days} days.',
    pushTitle: '{subscription_name} cancelled',
    pushBody: 'Subscription cancelled due to payment issues.',
    actionLabel: 'Reactivate subscription',
    actionUrl: '/subscription/{subscription_id}/reactivate',
  },
];
