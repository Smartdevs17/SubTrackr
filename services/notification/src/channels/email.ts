/**
 * Email channel provider for the notification microservice.
 *
 * Delegates to the backend's `SendGridEmailProvider` / `SesEmailProvider`
 * (selected via EMAIL_PROVIDER env var) instead of the previous no-op stub.
 */

import { ChannelProvider } from '../types/channel';
import type { Notification } from '../types/notification';
import {
  createEmailProviderFromEnv,
  getEmailFromAddress,
  type EmailProvider as BackendEmailProvider,
} from '../../../../backend/services/notification/emailProvider';

export class EmailProvider implements ChannelProvider {
  private readonly provider: BackendEmailProvider;

  constructor(apiKey: string) {
    // `apiKey` param kept for backward-compat with the factory that passes it.
    // We prefer the full env-based factory so provider selection (SG vs SES)
    // is centralised in one place.
    this.provider = createEmailProviderFromEnv(
      apiKey ? { ...process.env, SENDGRID_API_KEY: apiKey } : process.env
    );
  }

  async send(
    notification: Notification
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const from = getEmailFromAddress();
    const result = await this.provider.send({
      to: { email: notification.recipient },
      from,
      subject: notification.template,
      text: Object.entries(notification.variables ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
      tags: ['notification-service'],
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };
  }
}
