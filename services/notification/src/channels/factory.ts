import { ChannelProvider } from '../types/channel';
import { EmailProvider } from './email';
import { PushProvider } from './push';
import { SMSProvider } from './sms';
import { Notification } from '../types/notification';

export class ChannelFactory {
  private providers: Map<string, ChannelProvider> = new Map();

  register(channel: string, provider: ChannelProvider) {
    this.providers.set(channel, provider);
  }

  get(channel: string): ChannelProvider {
    const provider = this.providers.get(channel);
    if (!provider) throw new Error(`No provider registered for channel: ${channel}`);
    return provider;
  }

  async dispatch(notification: Notification): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const provider = this.get(notification.channel);
    return provider.send(notification);
  }
}

export function createDefaultFactory(env: Record<string, string | undefined>): ChannelFactory {
  const factory = new ChannelFactory();
  factory.register('email', new EmailProvider(env.SENDGRID_API_KEY ?? ''));
  factory.register('push', new PushProvider(env.EXPO_ACCESS_TOKEN));
  factory.register('sms', new SMSProvider(
    env.TWILIO_ACCOUNT_SID ?? '',
    env.TWILIO_AUTH_TOKEN ?? '',
    env.TWILIO_FROM_NUMBER ?? ''
  ));
  return factory;
}
