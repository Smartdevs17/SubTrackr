import { describe, it, expect, vi, afterEach } from 'vitest';
import { PushProvider } from '../channels/push.js';
import type { Notification } from '../types/notification.js';

const notification: Notification = {
  id: 'n-1',
  channel: 'push',
  template: 'Payment failed',
  recipient: 'ExponentPushToken[abc]',
  variables: { amount: '10.00' },
  priority: 'high',
};

const sendMock = vi.fn();

vi.mock('expo-server-sdk', () => ({
  Expo: class {
    sendPushNotificationsAsync = sendMock;
  },
}));

afterEach(() => {
  sendMock.mockReset();
});

describe('PushProvider', () => {
  it('reports failure when EXPO_ACCESS_TOKEN is missing instead of faking success', async () => {
    const result = await new PushProvider(undefined).send(notification);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/EXPO_ACCESS_TOKEN/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns the Expo ticket id on success', async () => {
    sendMock.mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);

    const result = await new PushProvider('token').send(notification);

    expect(sendMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ success: true, messageId: 'ticket-1' });
  });

  it('surfaces an Expo error receipt as a failure', async () => {
    sendMock.mockResolvedValue([{ status: 'error', message: 'Device not registered' }]);

    const result = await new PushProvider('token').send(notification);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Device not registered');
  });

  it('treats a thrown transport error as a failure', async () => {
    sendMock.mockRejectedValue(new Error('network down'));

    const result = await new PushProvider('token').send(notification);

    expect(result).toEqual({ success: false, error: 'network down' });
  });
});
