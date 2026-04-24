import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';

const SESSION_STORAGE_KEY = '@subtrackr_sessions';
const SESSION_SETTINGS_KEY = '@subtrackr_session_settings';

export interface SessionRecord {
  id: string;
  deviceName: string;
  platform: string;
  createdAt: number;
  lastActiveAt: number;
  isCurrent: boolean;
  revokedAt?: number;
  suspicious?: boolean;
  reason?: string;
}

export interface SessionSettings {
  timeoutMinutes: number;
}

const defaultSettings: SessionSettings = {
  timeoutMinutes: 30,
};

const now = () => Date.now();

const readSessions = async (): Promise<SessionRecord[]> => {
  const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as SessionRecord[]) : [];
};

const writeSessions = async (sessions: SessionRecord[]) => {
  await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
};

export const sessionService = {
  async getSettings(): Promise<SessionSettings> {
    const raw = await AsyncStorage.getItem(SESSION_SETTINGS_KEY);
    return raw ? ({ ...defaultSettings, ...(JSON.parse(raw) as SessionSettings) } as SessionSettings) : defaultSettings;
  },

  async updateSettings(settings: Partial<SessionSettings>): Promise<SessionSettings> {
    const merged = { ...(await this.getSettings()), ...settings };
    await AsyncStorage.setItem(SESSION_SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  },

  async getSessions(): Promise<SessionRecord[]> {
    const settings = await this.getSettings();
    const sessions = await readSessions();
    const expiryMs = settings.timeoutMinutes * 60 * 1000;
    const refreshed = sessions.map((session) => {
      if (session.revokedAt) return session;
      if (now() - session.lastActiveAt > expiryMs) {
        return { ...session, revokedAt: now(), reason: 'Session timeout' };
      }
      return session;
    });
    await writeSessions(refreshed);
    return refreshed.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  },

  async initializeCurrentSession(): Promise<SessionRecord> {
    const sessions = await readSessions();
    const existingCurrent = sessions.find((session) => session.isCurrent && !session.revokedAt);
    if (existingCurrent) {
      return this.touchSession(existingCurrent.id);
    }

    const current: SessionRecord = {
      id: `session_${now()}_${Math.random().toString(36).slice(2, 7)}`,
      deviceName: Application.applicationName || 'SubTrackr Device',
      platform: Application.nativeApplicationVersion || 'unknown',
      createdAt: now(),
      lastActiveAt: now(),
      isCurrent: true,
    };

    await writeSessions([current, ...sessions.map((session) => ({ ...session, isCurrent: false }))]);
    return current;
  },

  async touchSession(sessionId: string): Promise<SessionRecord> {
    const sessions = await readSessions();
    let target: SessionRecord | undefined;
    const updated = sessions.map((session) => {
      if (session.id !== sessionId) return session;
      target = { ...session, lastActiveAt: now() };
      return target;
    });
    await writeSessions(updated);
    if (!target) throw new Error('Session not found');
    return target;
  },

  async revokeSession(sessionId: string): Promise<void> {
    const sessions = await readSessions();
    const updated = sessions.map((session) =>
      session.id === sessionId ? { ...session, revokedAt: now(), isCurrent: false, reason: 'Revoked by user' } : session
    );
    await writeSessions(updated);
  },

  async revokeOtherSessions(currentSessionId: string): Promise<void> {
    const sessions = await readSessions();
    const updated = sessions.map((session) =>
      session.id !== currentSessionId && !session.revokedAt
        ? { ...session, revokedAt: now(), isCurrent: false, reason: 'Forced logout from current session' }
        : session
    );
    await writeSessions(updated);
  },

  async detectSuspiciousSessions(): Promise<SessionRecord[]> {
    const sessions = await readSessions();
    const activeSessions = sessions.filter((session) => !session.revokedAt);
    const suspicious = activeSessions.length > 3;
    if (!suspicious) return sessions;

    const flagged = sessions.map((session, index) =>
      !session.revokedAt && index >= 2
        ? { ...session, suspicious: true, reason: 'Unusual number of concurrent sessions' }
        : session
    );
    await writeSessions(flagged);
    return flagged;
  },
};
