import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { ChannelProvider } from '../types/channel.js';
import type { Notification } from '../types/notification.js';

/**
 * Push channel provider backed by Expo's push notification service.
 *
 * Requires `EXPO_ACCESS_TOKEN`. Without it, sends are reported as failures
 * rather than silently acknowledged, so the queue can redeliver once
 * credentials are configured.
 */
export class PushProvider implements ChannelProvider {
  private readonly expo: Expo | null;

  constructor(expoAccessToken?: string) {
    this.expo = expoAccessToken ? new Expo({ accessToken: expoAccessToken }) : null;
  }

  async send(
    notification: Notification
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.expo) {
      const error = 'EXPO_ACCESS_TOKEN is not configured';
      console.error(`[PushProvider] ${error}`);
      return { success: false, error };
    }

    const message: ExpoPushMessage = {
      to: notification.recipient,
      title: notification.template,
      body: Object.entries(notification.variables ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
      sound: 'default',
      priority: notification.priority === 'high' ? 'high' : 'default',
      data: notification.metadata,
    };

    try {
      const tickets = await this.expo.sendPushNotificationsAsync([message]);
      const ticket = tickets[0];

      if (!ticket) {
        return { success: false, error: 'Expo returned no ticket' };
      }
      if (ticket.status === 'ok') {
        return { success: true, messageId: ticket.id };
      }
      return {
        success: false,
        error: ticket.message ?? `Expo status: ${ticket.status}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown Expo error';
      console.error(`[PushProvider] send failed: ${error}`);
      return { success: false, error };
    }
  }
}
