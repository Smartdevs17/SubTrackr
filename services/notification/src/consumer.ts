import { ChannelFactory } from './channels/factory.js';
import { Notification } from './types/notification.js';

let factory: ChannelFactory;

export function setChannelFactory(f: ChannelFactory) {
  factory = f;
}

export async function processNotification(message: Notification): Promise<void> {
  if (!factory) throw new Error('ChannelFactory not initialized');
  const result = await factory.dispatch(message);
  if (!result.success) {
    throw new Error(result.error ?? 'Notification delivery failed');
  }
}
