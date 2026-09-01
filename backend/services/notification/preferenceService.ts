import { logger } from '../logging';

export interface NotificationPreferences {
  userId: string;
  channels: {
    push: boolean;
    email: boolean;
    sms: boolean;
    inApp: boolean;
  };
  frequency: 'immediate' | 'daily' | 'weekly';
  quietHours: {
    enabled: boolean;
    startTime: string; // HH:mm format
    endTime: string;
    timezone: string;
  };
}

const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'userId'> = {
  channels: { push: true, email: true, sms: false, inApp: true },
  frequency: 'immediate',
  quietHours: { enabled: false, startTime: '22:00', endTime: '08:00', timezone: 'UTC' },
};

const parseTime = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};

export class NotificationPreferenceService {
  private readonly preferences = new Map<string, NotificationPreferences>();

  async getPreferences(userId: string): Promise<NotificationPreferences | null> {
    return this.preferences.get(userId) ?? null;
  }

  async updatePreferences(userId: string, prefs: Partial<NotificationPreferences>): Promise<boolean> {
    const current = this.preferences.get(userId) ?? { userId, ...DEFAULT_PREFERENCES };
    const updated: NotificationPreferences = {
      ...current,
      ...prefs,
      userId,
      channels: { ...current.channels, ...prefs.channels },
      quietHours: { ...current.quietHours, ...prefs.quietHours },
    };
    this.preferences.set(userId, updated);
    logger.info('Updated notification preferences for user', { userId, prefs: updated });
    return true;
  }

  shouldDeliverNow(prefs: NotificationPreferences): boolean {
    if (!prefs.quietHours.enabled) return true;

    const start = parseTime(prefs.quietHours.startTime);
    const end = parseTime(prefs.quietHours.endTime);
    if (start === null || end === null) return true;

    let current: number;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: prefs.quietHours.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(new Date());
      const hour = Number(parts.find((part) => part.type === 'hour')?.value);
      const minute = Number(parts.find((part) => part.type === 'minute')?.value);
      current = hour * 60 + minute;
    } catch {
      return true;
    }

    return start === end ? false : start < end
      ? current < start || current >= end
      : current < start && current >= end;
  }
}
