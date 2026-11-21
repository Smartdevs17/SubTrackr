import { ChannelFactory } from './channels/factory.js';
import { RuleEngine, type Decision } from './rules/engine.js';
import { NotificationSchema, type Notification } from './types/notification.js';

export interface Logger {
  info(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
}

const jsonLogger: Logger = {
  info: (fields) => console.log(JSON.stringify({ level: 'info', ...fields })),
  error: (fields) => console.error(JSON.stringify({ level: 'error', ...fields })),
};

/** Thrown for messages that can never be delivered; the caller should not requeue them. */
export class InvalidNotificationError extends Error {}

let factory: ChannelFactory;
let engine = new RuleEngine();
let logger: Logger = jsonLogger;

export function setChannelFactory(f: ChannelFactory) {
  factory = f;
}

export function setRuleEngine(e: RuleEngine) {
  engine = e;
}

export function setLogger(l: Logger) {
  logger = l;
}

export async function processNotification(message: unknown): Promise<Decision> {
  if (!factory) throw new Error('ChannelFactory not initialized');

  const parsed = NotificationSchema.safeParse(message);
  if (!parsed.success) {
    throw new InvalidNotificationError(`Invalid notification: ${parsed.error.message}`);
  }
  const notification: Notification = parsed.data;
  const decision = engine.evaluate(notification);

  logger.info({
    event: 'notification.decision',
    notificationId: notification.id,
    matchedRules: decision.matchedRules,
    channels: decision.deliveries.map((d) => d.channel),
    suppressedBy: decision.suppressedBy,
    deferredUntil: decision.deferredUntil?.toISOString(),
  });

  const results = await Promise.all(
    decision.deliveries.map(async (delivery) => ({
      channel: delivery.channel,
      result: await factory.dispatch(delivery),
    }))
  );
  const failed = results.filter(({ result }) => !result.success);
  for (const { channel, result } of failed) {
    logger.error({
      event: 'notification.delivery_failed',
      notificationId: notification.id,
      channel,
      error: result.error,
    });
  }
  if (failed.length > 0) {
    throw new Error(failed[0].result.error ?? 'Notification delivery failed');
  }
  return decision;
}
