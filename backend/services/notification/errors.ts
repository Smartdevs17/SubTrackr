import { DomainError } from '../shared/errors';
import { ErrorCode } from '../shared/apiResponse';

/**
 * Notification module error codes.
 * All codes follow pattern: NOTIF_[CATEGORY]_[SPECIFIC]
 */
export const NotificationErrorCode = {
  DELIVERY_FAILED: 'NOTIF_DELIVERY_FAILED' as ErrorCode,
  PREFERENCE_NOT_FOUND: 'NOTIF_PREFERENCE_NOT_FOUND' as ErrorCode,
  WEBHOOK_REGISTRATION_FAILED: 'NOTIF_WEBHOOK_REGISTRATION_FAILED' as ErrorCode,
  WEBHOOK_DELIVERY_FAILED: 'NOTIF_WEBHOOK_DELIVERY_FAILED' as ErrorCode,
  WEBHOOK_HEALTH_FAILED: 'NOTIF_WEBHOOK_HEALTH_FAILED' as ErrorCode,
  ALERT_DISPATCH_FAILED: 'NOTIF_ALERT_DISPATCH_FAILED' as ErrorCode,
  WEBSOCKET_CONNECTION_FAILED: 'NOTIF_WEBSOCKET_CONNECTION_FAILED' as ErrorCode,
  BROADCAST_FAILED: 'NOTIF_BROADCAST_FAILED' as ErrorCode,
  INVALID_CHANNEL_CONFIG: 'NOTIF_INVALID_CHANNEL_CONFIG' as ErrorCode,
  RATE_LIMITED: 'NOTIF_RATE_LIMITED' as ErrorCode,
} as const;

export class NotificationError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(code, message, details);
  }

  static deliveryFailed(recipientId: string, reason: string): NotificationError {
    return new NotificationError(
      NotificationErrorCode.DELIVERY_FAILED,
      `Notification delivery failed for ${recipientId}: ${reason}`,
      { recipientId, reason }
    );
  }

  static webhookDeliveryFailed(webhookId: string, statusCode: number): NotificationError {
    return new NotificationError(
      NotificationErrorCode.WEBHOOK_DELIVERY_FAILED,
      `Webhook delivery failed for ${webhookId} (HTTP ${statusCode})`,
      { webhookId, statusCode: String(statusCode) }
    );
  }

  static alertDispatchFailed(channel: string, alertTitle: string): NotificationError {
    return new NotificationError(
      NotificationErrorCode.ALERT_DISPATCH_FAILED,
      `Failed to dispatch alert "${alertTitle}" via ${channel}`,
      { channel, alertTitle }
    );
  }
}
