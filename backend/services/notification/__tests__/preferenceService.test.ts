import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { NotificationPreferenceService } from '../preferenceService';

describe('NotificationPreferenceService', () => {
  let service: NotificationPreferenceService;

  beforeEach(() => {
    service = new NotificationPreferenceService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns updated preferences and merges nested patches', async () => {
    expect(await service.getPreferences('user-1')).toBeNull();

    await service.updatePreferences('user-1', {
      channels: { email: false } as never,
      quietHours: { enabled: true } as never,
    });

    await expect(service.getPreferences('user-1')).resolves.toEqual({
      userId: 'user-1',
      channels: { push: true, email: false, sms: false, inApp: true },
      frequency: 'immediate',
      quietHours: { enabled: true, startTime: '22:00', endTime: '08:00', timezone: 'UTC' },
    });
  });

  it('evaluates quiet hours in the configured timezone', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T23:30:00.000Z'));
    const preferences = {
      userId: 'user-1',
      channels: { push: true, email: true, sms: false, inApp: true },
      frequency: 'immediate' as const,
      quietHours: { enabled: true, startTime: '22:00', endTime: '08:00', timezone: 'UTC' },
    };

    expect(service.shouldDeliverNow(preferences)).toBe(false);
    expect(service.shouldDeliverNow({ ...preferences, quietHours: { ...preferences.quietHours, enabled: false } })).toBe(true);
  });
});
