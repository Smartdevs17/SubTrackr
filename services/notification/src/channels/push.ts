import { ChannelProvider } from '../types/channel';

export class PushProvider implements ChannelProvider {
  constructor(private readonly expoAccessToken?: string) {}

  async send(notification: import('../types/notification').Notification): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return { success: true, messageId: `push-${Date.now()}` };
  }
}
