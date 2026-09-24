/**
 * SMS channel provider for the notification microservice.
 *
 * Delegates to the backend's TwilioSmsProvider instead of the previous stub.
 */

import { ChannelProvider } from '../types/channel';
import type { Notification } from '../types/notification';
import {
  createSmsProviderFromEnv,
  type SmsProvider,
} from '../../../../backend/services/notification/smsProvider';

export class SMSProvider implements ChannelProvider {
  private readonly provider: SmsProvider;

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    // Params kept for backward-compat with the factory signature.
    // The env-based factory is preferred so config stays centralised.
    this.provider = createSmsProviderFromEnv(
      accountSid
        ? {
            ...process.env,
            TWILIO_ACCOUNT_SID: accountSid,
            TWILIO_AUTH_TOKEN: authToken,
            TWILIO_FROM_NUMBER: fromNumber,
          }
        : process.env
    );
  }

  async send(
    notification: Notification
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const result = await this.provider.send({
      to: notification.recipient,
      body: notification.variables?.['body'] ?? notification.template,
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };
  }
}
