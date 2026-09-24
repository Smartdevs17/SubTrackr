export { NotificationPreferenceService } from './preferenceService';
export type { NotificationPreferences } from './preferenceService';
export { AlertingService } from './alerting';
export type { AlertDispatcher } from './alerting';
export {
  WebhookDeliveryService,
  webhookDeliveryService,
  WEBHOOK_IDEMPOTENCY_HEADER,
  verifyWebhookSignatureAny,
} from './webhook';
export type { RegisterWebhookInput, WebhookDeliveryResult } from './webhook';
export { WebhookManagementApi, webhookManagementApi } from './webhookManagementApi';
export type { ApiResponse } from './webhookManagementApi';
export { DeliveryWorker, deliveryWorker } from './jobs/deliveryWorker';
export { DlqCleanupJob, dlqCleanupJob } from './jobs/dlqCleanupJob';
export { WebSocketServer, webSocketServer } from './websocket';
export type { SubscriptionEventType, SubscriptionEvent, EventFilter, ClientInfo } from './websocket';
export type { INotificationPreferenceService, IAlertingService, IWebhookDeliveryService, IWebsocketService } from './interfaces';
export {
  NotificationCenterService,
  notificationCenterService,
  defaultPreferences,
  defaultTypePreference,
  resolveChannels,
  isInQuietHours,
  nextDeliveryTime,
  renderTemplate,
  computeAnalytics,
  matchesHistoryFilter,
  MAX_HISTORY_PER_USER,
} from './notificationCenterService';
export type {
  ChannelTransport,
  DeliverInput,
  QuietHours,
  SubscriberNotificationPreferences,
} from './notificationCenterService';
export type {
  NotificationChannel,
  NotificationType,
  NotificationTypeMeta,
  NotificationStatus,
  NotificationRecord,
  NotificationStats,
  NotificationAnalytics,
  NotificationTemplate,
  NotificationHistoryFilter,
  DeliveryResult,
  RenderedTemplate,
  TypePreference,
} from '../../../src/types/notification';
export {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_META,
} from '../../../src/types/notification';
export { NotificationError, NotificationErrorCode } from './errors';
export { DunningEmailSequenceService, dunningEmailSequenceService } from './dunningEmailSequences';
export {
  EmailTemplateEngine,
  emailTemplateEngine,
  ComponentRenderer,
  substituteVariables,
  BUILTIN_TEMPLATES,
  PRESET_COMPONENTS,
  createDefaultTemplate,
} from './emailTemplateEngine';
export type {
  ComponentType,
  ComponentProps,
  EmailComponent,
  LayoutName,
  LayoutConfig,
  ComponentTemplate,
  RenderResult,
  EngineRenderOptions,
} from './emailTemplateEngine';
export type {
  DunningEmailVariant,
  DunningABTest,
  DunningABTestAssignment,
  DunningABTestResult,
  DunningEmailSequence,
  DunningSequenceStage,
  DunningEmailDeliveryLog,
  DunningDeliverabilityMetrics,
} from '../../../src/types/dunningABTest';

// ── Email Provider ────────────────────────────────────────────────────────────
export {
  SendGridEmailProvider,
  SesEmailProvider,
  buildEmailTransport,
  buildLegacyEmailSender,
  createEmailProviderFromEnv,
  createStubEmailProvider,
  getEmailFromAddress,
  emailProvider,
} from './emailProvider';
export type {
  EmailAddress,
  EmailAttachment,
  EmailMessage,
  EmailResult,
  EmailProvider,
  EmailTransportConfig,
  SendGridConfig,
  SesConfig,
} from './emailProvider';

// ── SMS Provider ──────────────────────────────────────────────────────────────
export {
  TwilioSmsProvider,
  buildSmsTransport,
  buildLegacySmsSender,
  createSmsProviderFromEnv,
  createStubSmsProvider,
  smsProvider,
  optOutStore,
  isGsm7,
  smsSegmentCount,
  truncateSms,
} from './smsProvider';
export type {
  SmsMessage,
  SmsResult,
  SmsProvider,
  TwilioConfig,
} from './smsProvider';

// ── Slack ─────────────────────────────────────────────────────────────────────
export {
  SlackNotifier,
  SlackAlertDispatcher,
  buildSubscriptionAlertMessage,
  buildSystemAlertMessage,
  createSlackNotifierFromEnv,
  createSlackAlertDispatcherFromEnv,
  slackNotifier,
} from './slack';
export type {
  SlackMessage,
  SlackNotifierConfig,
  SlackDeliveryResult,
  SubscriptionAlertContext,
} from './slack';

// ── Webhook Queue (BullMQ) ────────────────────────────────────────────────────
export {
  WebhookQueue,
  WebhookQueueWorker,
  WebhookRetryScheduler,
  DlqReplayWorker,
  eventPriority,
} from './jobs/webhookQueue';
export type {
  WebhookQueueConfig,
  WebhookQueueWorkerConfig,
  WebhookWorkerMetrics,
  WebhookJobData,
} from './jobs/webhookQueue';

// ── Subscription Notifier ─────────────────────────────────────────────────────
export { SubscriptionNotifier, subscriptionNotifier } from './subscriptionNotifier';
export type {
  NotificationRecipient,
  SubscriptionContext,
  SubscriptionNotifierDeps,
} from './subscriptionNotifier';
