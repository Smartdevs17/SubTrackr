import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  PaymentFailure,
  PaymentFailureNotification,
  PaymentRetryStrategy,
  PaymentFailureAnalytics,
  FailureNotificationRequest,
  FailureNotificationResponse,
  PaymentFailureHistory,
  FailureNotificationPreferences,
  SmartRetryConfig,
  PaymentFailureReason,
  EscalationLevel,
  FailureNotificationType,
  NotificationChannel,
  NotificationPriority,
  EscalationRule,
  RetryStatus,
  NotificationDeliveryStatus,
  PaymentFailureStatus,
} from '../types/paymentFailure';
import { DEFAULT_ESCALATION_RULES, DEFAULT_SMART_RETRY_CONFIG } from '../types/paymentFailure';

const STORAGE_KEYS = {
  FAILURES: '@SubTrackr:paymentFailures',
  NOTIFICATIONS: '@SubTrackr:failureNotifications',
  RETRIES: '@SubTrackr:retryStrategies',
  PREFERENCES: '@SubTrackr:failureNotificationPreferences',
  CONFIG: '@SubTrackr:smartRetryConfig',
} as const;

// ══════════════════════════════════════════════════════════════════════════════
// Payment Failure Management
// ══════════════════════════════════════════════════════════════════════════════

export async function recordPaymentFailure(
  failure: Omit<PaymentFailure, 'id' | 'failedAt'>
): Promise<PaymentFailure> {
  const newFailure: PaymentFailure = {
    ...failure,
    id: generateId(),
    failedAt: new Date(),
    escalationLevel: determineEscalationLevel(failure.retryCount),
    status: failure.retryCount < failure.maxRetries ? 'pending_retry' : 'awaiting_action',
  };

  await saveFailure(newFailure);

  // Schedule retry if applicable
  if (newFailure.retryCount < newFailure.maxRetries && shouldRetry(newFailure.failureReason)) {
    await scheduleRetry(newFailure);
  }

  // Send notifications
  await sendFailureNotification({
    failureId: newFailure.id,
    type: newFailure.retryCount === 0 ? 'initial_failure' : 'retry_failed',
    priority: getNotificationPriority(newFailure.escalationLevel),
  });

  return newFailure;
}

export async function getAllFailures(userId?: string): Promise<PaymentFailure[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.FAILURES);
    if (!data) return [];

    let failures: PaymentFailure[] = JSON.parse(data);
    failures = failures.map(deserializeFailure);

    if (userId) {
      return failures.filter((f) => f.userId === userId);
    }

    return failures;
  } catch (error) {
    console.error('Failed to load payment failures:', error);
    return [];
  }
}

export async function getFailureById(id: string): Promise<PaymentFailure | null> {
  const failures = await getAllFailures();
  return failures.find((f) => f.id === id) || null;
}

export async function getUnresolvedFailures(userId: string): Promise<PaymentFailure[]> {
  const failures = await getAllFailures(userId);
  return failures.filter((f) => !f.isResolved);
}

export async function resolveFailure(
  failureId: string,
  resolutionMethod: import('../types/paymentFailure').ResolutionMethod
): Promise<PaymentFailure> {
  const failure = await getFailureById(failureId);
  if (!failure) {
    throw new Error(`Payment failure ${failureId} not found`);
  }

  failure.isResolved = true;
  failure.resolvedAt = new Date();
  failure.resolutionMethod = resolutionMethod;
  failure.status = 'resolved';

  await updateFailure(failure);

  // Send resolution confirmation
  await sendFailureNotification({
    failureId,
    type: 'resolution_confirmation',
    priority: 'low',
  });

  return failure;
}

// ══════════════════════════════════════════════════════════════════════════════
// Retry Strategy Management
// ══════════════════════════════════════════════════════════════════════════════

export async function scheduleRetry(failure: PaymentFailure): Promise<PaymentRetryStrategy> {
  const config = await getSmartRetryConfig();
  const escalationRule = getEscalationRuleForLevel(failure.escalationLevel);

  const delayMinutes = config.exponentialBackoff
    ? Math.pow(config.backoffMultiplier, failure.retryCount) * config.baseDelayMinutes
    : escalationRule.retryDelayMinutes;

  const scheduledAt = new Date();
  scheduledAt.setMinutes(scheduledAt.getMinutes() + delayMinutes);

  const retry: PaymentRetryStrategy = {
    id: generateId(),
    failureId: failure.id,
    retryAttempt: failure.retryCount + 1,
    scheduledAt,
    status: 'scheduled',
    useAlternatePaymentMethod: config.tryAlternatePaymentMethods && failure.retryCount >= 2,
    delayMinutes,
  };

  await saveRetry(retry);

  // Update failure with next retry time
  failure.nextRetryAt = scheduledAt;
  failure.status = 'pending_retry';
  await updateFailure(failure);

  // Send retry scheduled notification
  await sendFailureNotification({
    failureId: failure.id,
    type: 'retry_scheduled',
    priority: 'medium',
    variables: {
      retryTime: scheduledAt.toLocaleString(),
      attemptNumber: retry.retryAttempt.toString(),
    },
  });

  return retry;
}

export async function executeRetry(retryId: string): Promise<PaymentRetryStrategy> {
  const retry = await getRetryById(retryId);
  if (!retry) {
    throw new Error(`Retry strategy ${retryId} not found`);
  }

  retry.status = 'executing';
  retry.executedAt = new Date();
  await updateRetry(retry);

  // Simulate payment retry (in real implementation, call payment gateway)
  const success = Math.random() > 0.5; // Mock: 50% success rate

  retry.result = {
    success,
    amount: 0, // Would come from payment attempt
    currency: 'USD',
    completedAt: new Date(),
    ...(success
      ? { transactionId: generateId() }
      : { failureReason: 'Card declined', failureCode: 'DECLINED' }),
  };

  retry.status = success ? 'succeeded' : 'failed';
  await updateRetry(retry);

  // Update original failure
  const failure = await getFailureById(retry.failureId);
  if (failure) {
    if (success) {
      await resolveFailure(failure.id, 'auto_retry_success');
    } else {
      failure.retryCount++;
      failure.escalationLevel = determineEscalationLevel(failure.retryCount);

      if (failure.retryCount >= failure.maxRetries) {
        failure.status = 'awaiting_action';
        await sendFailureNotification({
          failureId: failure.id,
          type: 'final_warning',
          priority: 'urgent',
        });
      } else {
        await scheduleRetry(failure);
      }

      await updateFailure(failure);
    }
  }

  return retry;
}

export async function getAllRetries(failureId?: string): Promise<PaymentRetryStrategy[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.RETRIES);
    if (!data) return [];

    let retries: PaymentRetryStrategy[] = JSON.parse(data);
    retries = retries.map(deserializeRetry);

    if (failureId) {
      return retries.filter((r) => r.failureId === failureId);
    }

    return retries;
  } catch (error) {
    console.error('Failed to load retries:', error);
    return [];
  }
}

export async function getRetryById(id: string): Promise<PaymentRetryStrategy | null> {
  const retries = await getAllRetries();
  return retries.find((r) => r.id === id) || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// Notification Management
// ══════════════════════════════════════════════════════════════════════════════

export async function sendFailureNotification(
  request: FailureNotificationRequest
): Promise<FailureNotificationResponse> {
  const failure = await getFailureById(request.failureId);
  if (!failure) {
    return {
      success: false,
      notificationIds: [],
      channelsUsed: [],
      deliveredChannels: [],
      failedChannels: [],
      error: 'Failure not found',
    };
  }

  const preferences = await getNotificationPreferences(failure.userId);
  const escalationRule = getEscalationRuleForLevel(failure.escalationLevel);

  // Determine channels to use
  const channels = request.channels || escalationRule.notificationChannels;
  const enabledChannels = channels.filter((ch) => preferences.enabledChannels[ch]);

  const notifications: PaymentFailureNotification[] = [];
  const deliveredChannels: NotificationChannel[] = [];
  const failedChannels: NotificationChannel[] = [];

  for (const channel of enabledChannels) {
    const template = getNotificationTemplate(request.type, failure.escalationLevel, channel);
    const rendered = renderTemplate(template, failure, request.variables);

    const notification: PaymentFailureNotification = {
      id: generateId(),
      failureId: failure.id,
      userId: failure.userId,
      type: request.type,
      channel,
      priority: request.priority || getNotificationPriority(failure.escalationLevel),
      title: rendered.title,
      message: rendered.message,
      actionRequired: escalationRule.actionRequired,
      actionUrl: `/payment-failures/${failure.id}`,
      actionLabel: 'Update Payment Method',
      escalationLevel: failure.escalationLevel,
      sentAt: new Date(),
      status: 'sent',
      retryCount: 0,
    };

    // Simulate delivery (in real implementation, use actual notification service)
    const delivered = Math.random() > 0.1; // Mock: 90% delivery rate
    if (delivered) {
      notification.deliveredAt = new Date();
      notification.status = 'delivered';
      deliveredChannels.push(channel);
    } else {
      notification.status = 'failed';
      notification.failureReason = 'Delivery failed';
      failedChannels.push(channel);
    }

    notifications.push(notification);
    await saveNotification(notification);
  }

  return {
    success: notifications.length > 0,
    notificationIds: notifications.map((n) => n.id),
    channelsUsed: enabledChannels,
    deliveredChannels,
    failedChannels,
    scheduledFor: request.scheduleAt,
  };
}

export async function getAllNotifications(
  failureId?: string,
  userId?: string
): Promise<PaymentFailureNotification[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    if (!data) return [];

    let notifications: PaymentFailureNotification[] = JSON.parse(data);
    notifications = notifications.map(deserializeNotification);

    if (failureId) {
      notifications = notifications.filter((n) => n.failureId === failureId);
    }
    if (userId) {
      notifications = notifications.filter((n) => n.userId === userId);
    }

    return notifications.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  } catch (error) {
    console.error('Failed to load notifications:', error);
    return [];
  }
}

export async function markNotificationAsRead(notificationId: string): Promise<void> {
  const notifications = await getAllNotifications();
  const notification = notifications.find((n) => n.id === notificationId);

  if (notification && !notification.readAt) {
    notification.readAt = new Date();
    await updateNotification(notification);
  }
}

export async function markNotificationAsClicked(notificationId: string): Promise<void> {
  const notifications = await getAllNotifications();
  const notification = notifications.find((n) => n.id === notificationId);

  if (notification && !notification.clickedAt) {
    notification.clickedAt = new Date();
    await updateNotification(notification);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Analytics
// ══════════════════════════════════════════════════════════════════════════════

export async function getPaymentFailureAnalytics(
  userId?: string
): Promise<PaymentFailureAnalytics> {
  const failures = await getAllFailures(userId);
  const notifications = await getAllNotifications(undefined, userId);
  const retries = await getAllRetries();

  const resolvedFailures = failures.filter((f) => f.isResolved);
  const unresolvedFailures = failures.filter((f) => !f.isResolved);

  const failuresByReason = failures.reduce(
    (acc, f) => {
      acc[f.failureReason] = (acc[f.failureReason] || 0) + 1;
      return acc;
    },
    {} as Record<PaymentFailureReason, number>
  );

  const failuresByEscalation = failures.reduce(
    (acc, f) => {
      acc[f.escalationLevel] = (acc[f.escalationLevel] || 0) + 1;
      return acc;
    },
    {} as Record<EscalationLevel, number>
  );

  const deliveredNotifications = notifications.filter((n) => n.status === 'delivered');
  const clickedNotifications = notifications.filter((n) => n.clickedAt);

  const successfulRetries = retries.filter((r) => r.status === 'succeeded');
  const failedRetries = retries.filter((r) => r.status === 'failed');

  // Calculate resolution times
  const resolutionTimes = resolvedFailures
    .filter((f) => f.resolvedAt && f.failedAt)
    .map((f) => (f.resolvedAt!.getTime() - f.failedAt.getTime()) / (1000 * 60 * 60)); // hours

  const averageResolutionTimeHours =
    resolutionTimes.length > 0
      ? resolutionTimes.reduce((sum, t) => sum + t, 0) / resolutionTimes.length
      : 0;

  // Top failure reasons
  const topFailureReasons = Object.entries(failuresByReason)
    .map(([reason, count]) => ({
      reason: reason as PaymentFailureReason,
      count,
      percentage: (count / failures.length) * 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Revenue calculations
  const revenueAtRisk = unresolvedFailures.reduce((sum, f) => sum + f.amount, 0);
  const revenueRecovered = resolvedFailures
    .filter(
      (f) => f.resolutionMethod === 'auto_retry_success' || f.resolutionMethod === 'manual_payment'
    )
    .reduce((sum, f) => sum + f.amount, 0);

  return {
    totalFailures: failures.length,
    resolvedFailures: resolvedFailures.length,
    unresolvedFailures: unresolvedFailures.length,
    resolutionRate: failures.length > 0 ? (resolvedFailures.length / failures.length) * 100 : 0,
    averageResolutionTimeHours,
    failuresByReason,
    failuresByEscalation,
    notificationsSent: notifications.length,
    notificationsDelivered: deliveredNotifications.length,
    notificationsClicked: clickedNotifications.length,
    deliveryRate:
      notifications.length > 0 ? (deliveredNotifications.length / notifications.length) * 100 : 0,
    clickThroughRate:
      deliveredNotifications.length > 0
        ? (clickedNotifications.length / deliveredNotifications.length) * 100
        : 0,
    retrySuccessRate:
      successfulRetries.length + failedRetries.length > 0
        ? (successfulRetries.length / (successfulRetries.length + failedRetries.length)) * 100
        : 0,
    topFailureReasons,
    revenueAtRisk,
    revenueRecovered,
    recoveryRate:
      revenueAtRisk + revenueRecovered > 0
        ? (revenueRecovered / (revenueAtRisk + revenueRecovered)) * 100
        : 0,
  };
}

export async function getPaymentFailureHistory(
  userId: string,
  page = 1,
  pageSize = 20
): Promise<PaymentFailureHistory> {
  const allFailures = await getAllFailures(userId);
  const totalCount = allFailures.length;
  const totalPages = Math.ceil(totalCount / pageSize);

  const startIndex = (page - 1) * pageSize;
  const failures = allFailures.slice(startIndex, startIndex + pageSize);

  const failureIds = failures.map((f) => f.id);
  const allNotifications = await getAllNotifications();
  const allRetries = await getAllRetries();

  const notifications = allNotifications.filter((n) => failureIds.includes(n.failureId));
  const retries = allRetries.filter((r) => failureIds.includes(r.failureId));

  return {
    failures,
    notifications,
    retries,
    totalPages,
    currentPage: page,
    totalCount,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Preferences & Configuration
// ══════════════════════════════════════════════════════════════════════════════

export async function getNotificationPreferences(
  userId: string
): Promise<FailureNotificationPreferences> {
  try {
    const data = await AsyncStorage.getItem(`${STORAGE_KEYS.PREFERENCES}_${userId}`);
    if (!data) {
      return getDefaultPreferences(userId);
    }

    const prefs = JSON.parse(data);
    return {
      ...prefs,
      updatedAt: new Date(prefs.updatedAt),
    };
  } catch (error) {
    console.error('Failed to load notification preferences:', error);
    return getDefaultPreferences(userId);
  }
}

export async function updateNotificationPreferences(
  preferences: FailureNotificationPreferences
): Promise<void> {
  preferences.updatedAt = new Date();
  await AsyncStorage.setItem(
    `${STORAGE_KEYS.PREFERENCES}_${preferences.userId}`,
    JSON.stringify(preferences)
  );
}

export async function getSmartRetryConfig(): Promise<SmartRetryConfig> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.CONFIG);
    if (!data) return DEFAULT_SMART_RETRY_CONFIG;
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load retry config:', error);
    return DEFAULT_SMART_RETRY_CONFIG;
  }
}

export async function updateSmartRetryConfig(config: SmartRetryConfig): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
}

// ══════════════════════════════════════════════════════════════════════════════
// Helper Functions
// ══════════════════════════════════════════════════════════════════════════════

function determineEscalationLevel(retryCount: number): EscalationLevel {
  if (retryCount === 0) return 'low';
  if (retryCount <= 2) return 'medium';
  if (retryCount <= 4) return 'high';
  return 'critical';
}

function getEscalationRuleForLevel(level: EscalationLevel): EscalationRule {
  return DEFAULT_ESCALATION_RULES.find((r) => r.level === level) || DEFAULT_ESCALATION_RULES[0];
}

function getNotificationPriority(escalationLevel: EscalationLevel): NotificationPriority {
  const map: Record<EscalationLevel, NotificationPriority> = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    critical: 'urgent',
  };
  return map[escalationLevel];
}

function shouldRetry(reason: PaymentFailureReason): boolean {
  const noRetryReasons: PaymentFailureReason[] = [
    'fraud_detected',
    'expired_card',
    'invalid_card',
    'currency_not_supported',
  ];
  return !noRetryReasons.includes(reason);
}

function getNotificationTemplate(
  type: FailureNotificationType,
  escalation: EscalationLevel,
  channel: NotificationChannel
): { title: string; message: string } {
  const templates: Record<FailureNotificationType, { title: string; message: string }> = {
    initial_failure: {
      title: 'Payment Failed',
      message:
        "Your payment for {{subscriptionName}} could not be processed. We'll retry automatically.",
    },
    retry_scheduled: {
      title: 'Payment Retry Scheduled',
      message: "We'll retry your payment for {{subscriptionName}} on {{retryTime}}.",
    },
    retry_failed: {
      title: 'Payment Retry Failed',
      message:
        'Another payment attempt for {{subscriptionName}} has failed. Please update your payment method.',
    },
    final_warning: {
      title: '🚨 Urgent: Final Payment Attempt',
      message:
        'This is the final attempt to process payment for {{subscriptionName}}. Your service may be suspended.',
    },
    suspension_notice: {
      title: 'Service Suspended',
      message: 'Your {{subscriptionName}} subscription has been suspended due to payment failure.',
    },
    resolution_confirmation: {
      title: 'Payment Issue Resolved',
      message: 'Thank you! Your payment for {{subscriptionName}} has been successfully processed.',
    },
    action_required: {
      title: 'Action Required: Update Payment',
      message:
        'Please update your payment method for {{subscriptionName}} to avoid service interruption.',
    },
    grace_period_ending: {
      title: 'Grace Period Ending Soon',
      message:
        'Your grace period for {{subscriptionName}} ends in {{daysLeft}} days. Please update payment.',
    },
  };

  return templates[type];
}

function renderTemplate(
  template: { title: string; message: string },
  failure: PaymentFailure,
  variables?: Record<string, string>
): { title: string; message: string } {
  const defaultVariables: Record<string, string> = {
    subscriptionName: failure.subscriptionName,
    amount: `${failure.currency} ${failure.amount.toFixed(2)}`,
    reason: failure.failureMessage,
  };

  const allVariables = { ...defaultVariables, ...variables };

  let title = template.title;
  let message = template.message;

  Object.entries(allVariables).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    title = title.replace(regex, value);
    message = message.replace(regex, value);
  });

  return { title, message };
}

function getDefaultPreferences(userId: string): FailureNotificationPreferences {
  return {
    userId,
    enabledChannels: {
      email: true,
      push: true,
      sms: false,
      in_app: true,
    },
    minimumPriority: 'low',
    consolidateNotifications: true,
    consolidationWindowMinutes: 30,
    updatedAt: new Date(),
  };
}

// Storage helpers
async function saveFailure(failure: PaymentFailure): Promise<void> {
  const failures = await getAllFailures();
  failures.push(failure);
  await AsyncStorage.setItem(STORAGE_KEYS.FAILURES, JSON.stringify(failures));
}

async function updateFailure(failure: PaymentFailure): Promise<void> {
  const failures = await getAllFailures();
  const index = failures.findIndex((f) => f.id === failure.id);
  if (index >= 0) {
    failures[index] = failure;
    await AsyncStorage.setItem(STORAGE_KEYS.FAILURES, JSON.stringify(failures));
  }
}

async function saveRetry(retry: PaymentRetryStrategy): Promise<void> {
  const retries = await getAllRetries();
  retries.push(retry);
  await AsyncStorage.setItem(STORAGE_KEYS.RETRIES, JSON.stringify(retries));
}

async function updateRetry(retry: PaymentRetryStrategy): Promise<void> {
  const retries = await getAllRetries();
  const index = retries.findIndex((r) => r.id === retry.id);
  if (index >= 0) {
    retries[index] = retry;
    await AsyncStorage.setItem(STORAGE_KEYS.RETRIES, JSON.stringify(retries));
  }
}

async function saveNotification(notification: PaymentFailureNotification): Promise<void> {
  const notifications = await getAllNotifications();
  notifications.push(notification);
  await AsyncStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifications));
}

async function updateNotification(notification: PaymentFailureNotification): Promise<void> {
  const notifications = await getAllNotifications();
  const index = notifications.findIndex((n) => n.id === notification.id);
  if (index >= 0) {
    notifications[index] = notification;
    await AsyncStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifications));
  }
}

// Deserialization helpers
function deserializeFailure(f: any): PaymentFailure {
  return {
    ...f,
    failedAt: new Date(f.failedAt),
    nextRetryAt: f.nextRetryAt ? new Date(f.nextRetryAt) : undefined,
    resolvedAt: f.resolvedAt ? new Date(f.resolvedAt) : undefined,
  };
}

function deserializeRetry(r: any): PaymentRetryStrategy {
  return {
    ...r,
    scheduledAt: new Date(r.scheduledAt),
    executedAt: r.executedAt ? new Date(r.executedAt) : undefined,
    result: r.result
      ? {
          ...r.result,
          completedAt: new Date(r.result.completedAt),
        }
      : undefined,
  };
}

function deserializeNotification(n: any): PaymentFailureNotification {
  return {
    ...n,
    sentAt: new Date(n.sentAt),
    deliveredAt: n.deliveredAt ? new Date(n.deliveredAt) : undefined,
    readAt: n.readAt ? new Date(n.readAt) : undefined,
    clickedAt: n.clickedAt ? new Date(n.clickedAt) : undefined,
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
