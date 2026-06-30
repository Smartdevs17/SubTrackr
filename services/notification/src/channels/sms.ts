import { ChannelProvider } from '../types/channel';

export class SMSProvider implements ChannelProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string
  ) {}

  async send(
    notification: import('../types/notification').Notification
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return { success: true, messageId: `sms-${Date.now()}` };
  }
}
