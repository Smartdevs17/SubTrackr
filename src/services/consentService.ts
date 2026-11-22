/**
 * consentService.ts — GDPR consent management.
 *
 * Owns the user's consent decisions for optional data processing:
 *  - persists the current preferences locally so a withdrawal takes effect
 *    immediately, even when offline;
 *  - keeps an append-only audit trail of every change (Art. 7(1) GDPR —
 *    the controller must be able to demonstrate consent);
 *  - ties consent to a policy version so users are re-prompted whenever the
 *    privacy policy changes;
 *  - queues records that failed to reach the backend and retries them later.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { gdprService, ConsentPreferences } from './gdpr';
import { logger } from './logging';
import { ConsentRecord } from '../types/gdpr';

export type { ConsentPreferences };

export type ConsentCategory = keyof ConsentPreferences;

export type ConsentSource = 'banner' | 'settings';

export type LegalBasis = 'consent' | 'contract';

export interface ConsentCategoryDefinition {
  key: ConsentCategory;
  title: string;
  description: string;
  legalBasis: LegalBasis;
}

export interface EssentialProcessingDefinition {
  title: string;
  description: string;
  legalBasis: LegalBasis;
}

export interface StoredConsent {
  policyVersion: string;
  preferences: ConsentPreferences;
  updatedAt: string;
  /** Most recent first, capped at MAX_CONSENT_HISTORY. */
  history: ConsentRecord[];
  /** Records not yet acknowledged by the backend. */
  pendingRecords: ConsentRecord[];
}

export interface SaveConsentResult {
  consent: StoredConsent;
  synced: boolean;
}

export interface ConsentStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type ConsentTransport = (
  userId: string,
  preferences: ConsentPreferences,
  records: ConsentRecord[]
) => Promise<void>;

export interface ConsentServiceOptions {
  storage?: ConsentStorage;
  transport?: ConsentTransport;
  policyVersion?: string;
  now?: () => Date;
}

export const CONSENT_POLICY_VERSION = '2026-09-01';
export const CONSENT_STORAGE_KEY = '@subtrackr/gdpr_consent';
export const MAX_CONSENT_HISTORY = 50;

export const CONSENT_CATEGORIES: ConsentCategoryDefinition[] = [
  {
    key: 'analytics',
    title: 'Analytics',
    description: 'Share anonymous usage data so we can understand and improve the app.',
    legalBasis: 'consent',
  },
  {
    key: 'marketing',
    title: 'Marketing',
    description: 'Receive product news, feature announcements, and promotional offers.',
    legalBasis: 'consent',
  },
  {
    key: 'notifications',
    title: 'Notifications',
    description: 'Receive billing reminders and renewal alerts as push notifications.',
    legalBasis: 'consent',
  },
];

export const ESSENTIAL_PROCESSING: EssentialProcessingDefinition = {
  title: 'Essential',
  description:
    'Required to run your account, store your subscriptions, and keep the app secure. Cannot be turned off.',
  legalBasis: 'contract',
};

/** Nothing is pre-ticked: GDPR consent must be an explicit opt-in. */
export const DEFAULT_CONSENT_PREFERENCES: ConsentPreferences = {
  analytics: false,
  marketing: false,
  notifications: false,
};

export class ConsentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsentValidationError';
  }
}

const CATEGORY_KEYS = CONSENT_CATEGORIES.map((c) => c.key);

export function allConsent(granted: boolean): ConsentPreferences {
  return { analytics: granted, marketing: granted, notifications: granted };
}

function isPreferences(value: unknown): value is ConsentPreferences {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return CATEGORY_KEYS.every((key) => typeof record[key] === 'boolean');
}

function isStoredConsent(value: unknown): value is StoredConsent {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.policyVersion === 'string' &&
    typeof record.updatedAt === 'string' &&
    isPreferences(record.preferences) &&
    Array.isArray(record.history) &&
    Array.isArray(record.pendingRecords)
  );
}

const defaultTransport: ConsentTransport = async (_userId, preferences) => {
  await gdprService.updateConsent(preferences);
};

export function createConsentService(options: ConsentServiceOptions = {}) {
  const storage = options.storage ?? AsyncStorage;
  const transport = options.transport ?? defaultTransport;
  const policyVersion = options.policyVersion ?? CONSENT_POLICY_VERSION;
  const now = options.now ?? (() => new Date());
  let sequence = 0;

  const nextId = () => {
    sequence += 1;
    return `consent-${now().getTime()}-${sequence}`;
  };

  const persist = async (consent: StoredConsent) => {
    await storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));
  };

  const trySync = async (
    userId: string,
    preferences: ConsentPreferences,
    records: ConsentRecord[]
  ): Promise<boolean> => {
    if (records.length === 0) return true;
    try {
      await transport(userId, preferences, records);
      return true;
    } catch (error) {
      logger.warn('Consent sync failed; queued for retry', {
        pending: records.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  return {
    policyVersion,

    /**
     * Returns the stored consent, or null when the user has never decided.
     * Corrupt data is treated as "no decision" so the user is re-prompted
     * rather than silently assumed to have consented.
     */
    async load(): Promise<StoredConsent | null> {
      const raw = await storage.getItem(CONSENT_STORAGE_KEY);
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isStoredConsent(parsed)) return parsed;
      } catch {
        // fall through
      }
      logger.warn('Discarding malformed consent record');
      return null;
    },

    /** True when the user must be (re-)asked for consent. */
    requiresConsent(consent: StoredConsent | null): boolean {
      return consent === null || consent.policyVersion !== policyVersion;
    },

    async save(
      userId: string,
      preferences: ConsentPreferences,
      source: ConsentSource
    ): Promise<SaveConsentResult> {
      if (!userId.trim()) {
        throw new ConsentValidationError('A user id is required to record consent');
      }
      if (!isPreferences(preferences)) {
        throw new ConsentValidationError('Consent preferences must be booleans for every category');
      }

      const previous = await this.load();
      const isNewDecision = this.requiresConsent(previous);
      const timestamp = now().toISOString();

      // Record every category on a fresh decision (first run or new policy);
      // otherwise only the categories that actually changed.
      const records: ConsentRecord[] = CATEGORY_KEYS.filter(
        (key) => isNewDecision || previous?.preferences[key] !== preferences[key]
      ).map((key) => ({
        id: nextId(),
        userId,
        category: key,
        granted: preferences[key],
        timestamp,
        version: policyVersion,
        source,
      }));

      if (records.length === 0 && previous && previous.pendingRecords.length === 0) {
        return { consent: previous, synced: true };
      }

      const pending = [...(previous?.pendingRecords ?? []), ...records];
      const synced = await trySync(userId, preferences, pending);

      const consent: StoredConsent = {
        policyVersion,
        preferences: { ...preferences },
        updatedAt: records.length > 0 ? timestamp : (previous?.updatedAt ?? timestamp),
        history: [...[...records].reverse(), ...(previous?.history ?? [])].slice(
          0,
          MAX_CONSENT_HISTORY
        ),
        pendingRecords: synced ? [] : pending,
      };
      await persist(consent);

      logger.info('Consent recorded', {
        source,
        changed: records.map((r) => r.category),
        synced,
      });
      return { consent, synced };
    },

    /** Re-sends records that previously failed to reach the backend. */
    async retrySync(userId: string): Promise<SaveConsentResult | null> {
      const current = await this.load();
      if (!current) return null;
      const synced = await trySync(userId, current.preferences, current.pendingRecords);
      if (!synced) return { consent: current, synced };
      const consent = { ...current, pendingRecords: [] };
      await persist(consent);
      return { consent, synced };
    },
  };
}

export type ConsentService = ReturnType<typeof createConsentService>;

export const consentService = createConsentService();
