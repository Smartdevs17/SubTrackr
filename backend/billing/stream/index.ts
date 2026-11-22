/**
 * Billing Stream Processing — Public API
 *
 * Exports the core stream processor, producer, consumers, and their types.
 *
 * Quick-start:
 * ```ts
 * import {
 *   BillingEventStream,
 *   BillingStreamProducer,
 *   NotificationConsumer,
 *   AnalyticsConsumer,
 *   FraudDetectionConsumer,
 *   WebhookDispatchConsumer,
 * } from './backend/billing/stream';
 *
 * const stream = new BillingEventStream({ batchSize: 20, flushIntervalMs: 2_000 });
 * stream
 *   .registerConsumer(new NotificationConsumer())
 *   .registerConsumer(new AnalyticsConsumer())
 *   .registerConsumer(new FraudDetectionConsumer())
 *   .registerConsumer(new WebhookDispatchConsumer());
 * stream.start();
 *
 * const producer = new BillingStreamProducer();
 * await producer.publishChargeAttempted({ ... });
 * ```
 */

export { BillingEventStream } from './BillingEventStream';
export { BillingStreamProducer, billingStreamProducer } from './BillingStreamProducer';
export {
  NotificationConsumer,
  AnalyticsConsumer,
  FraudDetectionConsumer,
  WebhookDispatchConsumer,
  consoleNotificationSink,
  consoleAnalyticsSink,
  noopFraudSink,
  consoleWebhookSink,
} from './consumers';

export type {
  // Core stream types
  BillingStreamConsumer,
  BillingStreamEvent,
  BillingStreamEventName,
  BillingEventStreamConfig,
  BillingStreamMetrics,
  // New event payload types
  ChargeAttemptedPayload,
  ChargeFailedPayload,
  ChargeRetriedPayload,
  SubscriptionCancelledBillingPayload,
  // Re-exported existing payload types
  InvoiceGeneratedPayload,
  PaymentCapturedPayload,
  UsageThresholdReachedPayload,
  ChargebackRaisedPayload,
} from './types';

export type {
  // Producer input types
  ChargeAttemptedInput,
  ChargeFailedInput,
  ChargeRetriedInput,
  SubscriptionCancelledBillingInput,
} from './BillingStreamProducer';

export type {
  // Consumer sink interfaces
  NotificationSink,
  AnalyticsSink,
  FraudDetectionSink,
  FraudEvaluationResult,
  WebhookDispatchSink,
  WebhookPayload,
} from './consumers';
