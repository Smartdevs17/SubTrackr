/**
 * Payment failure notification flows
 *
 * Types for handling payment failures, retry logic, escalation,
 * and multi-channel notification delivery.
 */

import type { NotificationChannel } from './notification';

export interface PaymentFailure {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  userId: string;
  attemptId: string;
  amount: number;
  currency: string;
  failureReason: PaymentFailureReason;
  failureCode: string;
  failureMessage: string;
  paymentMethodId: string;
  paymentMethodType: PaymentMethodType;
  paymentMethodLast4?: string;
  failedAt: Date;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: Date;
  escalationLevel: EscalationLevel;
  status: PaymentFailureStatus;
  isResolved: boolean;
  resolvedAt?: Date;
  resolutionMethod?: ResolutionMethod;
  metadata?: Record<string, any>;
}

export enum PaymentFailureReason {
  INSUFFICIENT_FUNDS = 'insufficient_funds',
  CARD_DECLINED = 'card_declined',
  EXPIRED_CARD = 'expired_card',
  INVALID_CARD = 'invalid_card',
  NETWORK_ERROR = 'network_error',
  GATEWAY_ERROR = 'gateway_error',
  FRAUD_DETECTED = 'fraud_detected',
  AUTHENTICATION_REQUIRED = 'authentication_required',
  LIMIT_EXCEEDED = 'limit_exceeded',
  BLOCKED_PAYMENT = 'blocked_payment',
  CURRENCY_NOT_SUPPORTED = 'currency_not_supported',
  PROCESSING_ERROR = 'processing_error',
  PAYMENT_METHOD_NOT_FOUND = 'payment_method_not_found',
  UNKNOWN = 'unknown',
}

export enum PaymentMethodType {
  CREDIT_CARD = 'credit_card',
  DEBIT_CARD = 'debit_card',
  BANK_ACCOUNT = 'bank_account',
  CRYPTO = 'crypto',
  DIGITAL_WALLET = 'digital_wallet',
  OTHER = 'other',
}

export enum EscalationLevel {
  LOW = 'low', // First failure
  MEDIUM = 'medium', // 2-3 failures
  HIGH = 'high', // 4+ failures
  CRITICAL = 'critical', // Final attempt before suspension
}

export enum PaymentFailureStatus {
  PENDING_RETRY = 'pending_retry',
  RETRYING = 'retrying',
  AWAITING_ACTION = 'awaiting_action',
  SUSPENDED = 'suspended',
  RESOLVED = 'resolved',
  CANCELLED = 'cancelled',
}

export enum ResolutionMethod {
  PAYMENT_METHOD_UPDATED = 'payment_method_updated',
  MANUAL_PAYMENT = 'manual_payment',
  AUTO_RETRY_SUCCESS = 'auto_retry_success',
  SUBSCRIPTION_CANCELLED = 'subscription_cancelled',
  GRACE_PERIOD_EXTENDED = 'grace_period_extended',
}

export interface PaymentFailureNotification {
  id: string;
  failureId: string;
  userId: string;
  type: FailureNotificationType;
  channel: NotificationChannel;
  priority: NotificationPriority;
  title: string;
  message: string;
  actionRequired: boolean;
  actionUrl?: string;
  actionLabel?: string;
  escalationLevel: EscalationLevel;
  sentAt: Date;
  deliveredAt?: Date;
  readAt?: Date;
  clickedAt?: Date;
  status: NotificationDeliveryStatus;
  retryCount: number;
  failureReason?: string;
  metadata?: Record<string, any>;
}

export enum FailureNotificationType {
  INITIAL_FAILURE = 'initial_failure',
  RETRY_SCHEDULED = 'retry_scheduled',
  RETRY_FAILED = 'retry_failed',
  FINAL_WARNING = 'final_warning',
  SUSPENSION_NOTICE = 'suspension_notice',
  RESOLUTION_CONFIRMATION = 'resolution_confirmation',
  ACTION_REQUIRED = 'action_required',
  GRACE_PERIOD_ENDING = 'grace_period_ending',
}

export enum NotificationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum NotificationDeliveryStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  BOUNCED = 'bounced',
  SUPPRESSED = 'suppressed',
}

export interface PaymentRetryStrategy {
  id: string;
  failureId: string;
  retryAttempt: number;
  scheduledAt: Date;
  executedAt?: Date;
  status: RetryStatus;
  useAlternatePaymentMethod: boolean;
  alternatePaymentMethodId?: string;
  delayMinutes: number;
  result?: RetryResult;
}

export enum RetryStatus {
  SCHEDULED = 'scheduled',
  EXECUTING = 'executing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  CANCELLED = 'cancelled',
}

export interface RetryResult {
  success: boolean;
  transactionId?: string;
  failureReason?: string;
  failureCode?: string;
  amount: number;
  currency: string;
  completedAt: Date;
}

export interface EscalationRule {
  level: EscalationLevel;
  triggerAfterAttempts: number;
  notificationChannels: NotificationChannel[];
  retryDelayMinutes: number;
  actionRequired: boolean;
  suspendService: boolean;
  gracePeriodDays: number;
}

export const DEFAULT_ESCALATION_RULES: EscalationRule[] = [
  {
    level: EscalationLevel.LOW,
    triggerAfterAttempts: 1,
    notificationChannels: ['push', 'in_app'],
    retryDelayMinutes: 60, // 1 hour
    actionRequired: false,
    suspendService: false,
    gracePeriodDays: 7,
  },
  {
    level: EscalationLevel.MEDIUM,
    triggerAfterAttempts: 2,
    notificationChannels: ['push', 'email', 'in_app'],
    retryDelayMinutes: 1440, // 24 hours
    actionRequired: true,
    suspendService: false,
    gracePeriodDays: 5,
  },
  {
    level: EscalationLevel.HIGH,
    triggerAfterAttempts: 4,
    notificationChannels: ['push', 'email', 'sms', 'in_app'],
    retryDelayMinutes: 2880, // 48 hours
    actionRequired: true,
    suspendService: false,
    gracePeriodDays: 3,
  },
  {
    level: EscalationLevel.CRITICAL,
    triggerAfterAttempts: 6,
    notificationChannels: ['push', 'email', 'sms', 'in_app'],
    retryDelayMinutes: 0, // No more retries
    actionRequired: true,
    suspendService: true,
    gracePeriodDays: 1,
  },
];

export interface FailureNotificationTemplate {
  type: FailureNotificationType;
  escalationLevel: EscalationLevel;
  channel: NotificationChannel;
  subject: string;
  body: string;
  actionLabel?: string;
  variables: string[];
}

export interface PaymentFailureAnalytics {
  totalFailures: number;
  resolvedFailures: number;
  unresolvedFailures: number;
  resolutionRate: number;
  averageResolutionTimeHours: number;
  failuresByReason: Record<PaymentFailureReason, number>;
  failuresByEscalation: Record<EscalationLevel, number>;
  notificationsSent: number;
  notificationsDelivered: number;
  notificationsClicked: number;
  deliveryRate: number;
  clickThroughRate: number;
  retrySuccessRate: number;
  topFailureReasons: Array<{
    reason: PaymentFailureReason;
    count: number;
    percentage: number;
  }>;
  revenueAtRisk: number;
  revenueRecovered: number;
  recoveryRate: number;
}

export interface FailureNotificationRequest {
  failureId: string;
  type: FailureNotificationType;
  channels?: NotificationChannel[];
  priority?: NotificationPriority;
  variables?: Record<string, string>;
  scheduleAt?: Date;
  suppressDuplicates?: boolean;
}

export interface FailureNotificationResponse {
  success: boolean;
  notificationIds: string[];
  channelsUsed: NotificationChannel[];
  deliveredChannels: NotificationChannel[];
  failedChannels: NotificationChannel[];
  scheduledFor?: Date;
  error?: string;
}

export interface PaymentFailureHistory {
  failures: PaymentFailure[];
  notifications: PaymentFailureNotification[];
  retries: PaymentRetryStrategy[];
  totalPages: number;
  currentPage: number;
  totalCount: number;
}

export interface FailureNotificationPreferences {
  userId: string;
  enabledChannels: Record<NotificationChannel, boolean>;
  quietHoursStart?: string; // HH:mm format
  quietHoursEnd?: string;
  timezone?: string;
  minimumPriority: NotificationPriority;
  consolidateNotifications: boolean;
  consolidationWindowMinutes: number;
  updatedAt: Date;
}

export interface SmartRetryConfig {
  enabled: boolean;
  maxRetries: number;
  baseDelayMinutes: number;
  exponentialBackoff: boolean;
  backoffMultiplier: number;
  tryAlternatePaymentMethods: boolean;
  skipRetryOnFraud: boolean;
  skipRetryOnExpiredCard: boolean;
  intelligentScheduling: boolean; // Retry during user's typical active hours
}

export const DEFAULT_SMART_RETRY_CONFIG: SmartRetryConfig = {
  enabled: true,
  maxRetries: 6,
  baseDelayMinutes: 60,
  exponentialBackoff: true,
  backoffMultiplier: 2,
  tryAlternatePaymentMethods: true,
  skipRetryOnFraud: true,
  skipRetryOnExpiredCard: true,
  intelligentScheduling: true,
};
