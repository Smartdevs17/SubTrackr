import { ChannelProvider } from '../types/channel';

export class EmailProvider implements ChannelProvider {
  constructor(private readonly apiKey: string) {}

  async send(notification: import('../types/notification').Notification): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return { success: true, messageId: `email-${Date.now()}` };
  }
}
