import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelFactory, createDefaultFactory } from '../channels/factory.js';
import type { ChannelProvider } from '../types/channel.js';
import type { Notification } from '../types/notification.js';

const notification: Notification = {
  id: 'n-1',
  channel: 'email',
  template: 'Your receipt is ready',
  recipient: 'user@example.com',
  priority: 'normal',
};

function stubProvider(
  result: Partial<{ success: boolean; messageId?: string; error?: string }>
): ChannelProvider {
  return { send: async () => ({ success: true, ...result }) };
}

describe('ChannelFactory', () => {
  let factory: ChannelFactory;

  beforeEach(() => {
    factory = new ChannelFactory();
  });

  it('throws when dispatching to an unregistered channel', async () => {
    await expect(factory.dispatch(notification)).rejects.toThrow(
      'No provider registered for channel: email'
    );
  });

  it('routes a notification to the provider registered for its channel', async () => {
    const send = vi.fn().mockResolvedValue({ success: true, messageId: 'sg-1' });
    factory.register('email', { send });

    const result = await factory.dispatch(notification);

    expect(send).toHaveBeenCalledWith(notification);
    expect(result).toEqual({ success: true, messageId: 'sg-1' });
  });

  it('propagates a provider failure', async () => {
    factory.register('sms', stubProvider({ success: false, error: 'Twilio rejected' }));

    await expect(factory.dispatch({ ...notification, channel: 'sms' })).resolves.toEqual({
      success: false,
      messageId: undefined,
      error: 'Twilio rejected',
    });
  });
});

describe('createDefaultFactory', () => {
  it('registers a provider for every supported channel', () => {
    const built = createDefaultFactory({});
    expect(() => built.get('email')).not.toThrow();
    expect(() => built.get('push')).not.toThrow();
    expect(() => built.get('sms')).not.toThrow();
  });
});
