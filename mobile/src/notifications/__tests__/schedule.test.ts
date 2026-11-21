import { isNotificationDeliveryAllowed } from '../schedule';

describe('isNotificationDeliveryAllowed', () => {
  it('allows a push outside quiet hours', () => {
    expect(isNotificationDeliveryAllowed(
      { timezone: 'UTC', quietHours: { start: 22, end: 7 } },
      new Date('2026-11-21T12:00:00Z'),
    )).toBe(true);
  });

  it('blocks a push inside quiet hours or on disabled days', () => {
    const schedule = { timezone: 'UTC', quietHours: { start: 22, end: 7 }, days: [1, 2, 3, 4, 5] };
    expect(isNotificationDeliveryAllowed(schedule, new Date('2026-11-21T23:00:00Z'))).toBe(false);
    expect(isNotificationDeliveryAllowed(schedule, new Date('2026-11-22T12:00:00Z'))).toBe(false);
  });
});
