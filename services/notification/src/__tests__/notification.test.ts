import { describe, it, expect } from 'vitest';
import { NotificationSchema } from '../types/notification.js';

describe('NotificationSchema', () => {
  const valid = {
    id: 'n-1',
    channel: 'email',
    template: 'Your receipt is ready',
    recipient: 'user@example.com',
  };

  it('accepts a minimal notification and defaults priority', () => {
    const parsed = NotificationSchema.parse(valid);
    expect(parsed.priority).toBe('normal');
  });

  it('coerces scheduledAt to a Date', () => {
    const parsed = NotificationSchema.parse({
      ...valid,
      scheduledAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.scheduledAt).toBeInstanceOf(Date);
  });

  it('rejects an unknown channel', () => {
    expect(() => NotificationSchema.parse({ ...valid, channel: 'carrier-pigeon' })).toThrow();
  });

  it('requires recipient and template', () => {
    const { recipient: _recipient, ...noRecipient } = valid;
    expect(() => NotificationSchema.parse(noRecipient)).toThrow();
  });
});
