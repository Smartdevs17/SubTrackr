/**
 * Module-level tests for notification domain.
 * Validates error codes and DI container integration.
 */
import { Container } from '../../container';
import { NotificationError, NotificationErrorCode } from '../errors';

describe('Notification Module', () => {
  // ── Error handling ──────────────────────────────────────────────────────────

  describe('NotificationError', () => {
    it('creates deliveryFailed error', () => {
      const err = NotificationError.deliveryFailed('user_abc', 'channel_unavailable');
      expect(err.code).toBe(NotificationErrorCode.DELIVERY_FAILED);
      expect(err.details).toEqual({ recipientId: 'user_abc', reason: 'channel_unavailable' });
    });

    it('creates webhookDeliveryFailed error', () => {
      const err = NotificationError.webhookDeliveryFailed('wh_001', 502);
      expect(err.code).toBe(NotificationErrorCode.WEBHOOK_DELIVERY_FAILED);
      expect(err.details).toEqual({ webhookId: 'wh_001', statusCode: '502' });
    });

    it('creates alertDispatchFailed error', () => {
      const err = NotificationError.alertDispatchFailed('pagerduty', 'High Error Rate');
      expect(err.code).toBe(NotificationErrorCode.ALERT_DISPATCH_FAILED);
    });

    it('all error codes are unique within the module', () => {
      const codes = Object.values(NotificationErrorCode);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  // ── DI Container bindings ───────────────────────────────────────────────────

  describe('DI Container', () => {
    let container: Container;

    beforeEach(() => {
      container = new Container();
    });

    it('resolves INotificationPreferenceService', () => {
      container.bind('INotificationPreferenceService', () => ({ getPreferences: jest.fn() }));
      expect(container.resolve('INotificationPreferenceService')).toBeDefined();
    });

    it('resolves IAlertingService', () => {
      container.bind('IAlertingService', () => ({ dispatch: jest.fn() }));
      expect(container.resolve('IAlertingService')).toBeDefined();
    });

    it('resolves IWebhookDeliveryService', () => {
      container.bind('IWebhookDeliveryService', () => ({ deliverEvent: jest.fn() }));
      expect(container.resolve('IWebhookDeliveryService')).toBeDefined();
    });

    it('resolves IWebsocketService', () => {
      container.bind('IWebsocketService', () => ({ connect: jest.fn(), disconnect: jest.fn() }));
      expect(container.resolve('IWebsocketService')).toBeDefined();
    });
  });
});
