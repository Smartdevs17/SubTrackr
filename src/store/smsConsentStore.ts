/**
 * SMS consent ledger (on device) — #1747
 *
 * A local mirror of the server-side consent ledger. The screen fetches consent
 * records from `/api/sms-consent` and drops them in with `ingest`; mutations
 * (`applyConsent`) reflect the response of an opt-in/opt-out call so the list
 * updates without a refetch. Keeping the store pure (no network) means it can
 * be exercised in the backend Jest environment, which cannot load the React
 * Native preset.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';

const STORAGE_KEY = 'subtrackr-sms-consent';

/** How many consent records are retained on device. */
export const MAX_CONSENT_ENTRIES = 200;

export type ConsentStatus = 'opted_in' | 'opted_out';

export type ConsentSource = 'web_form' | 'inbound_sms' | 'admin' | 'import' | 'api' | 'system';

export interface SmsConsentRecord {
  phone: string;
  status: ConsentStatus;
  userId: string | null;
  source: ConsentSource;
  reason?: string;
  explicitOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SmsConsentEvent {
  phone: string;
  userId: string | null;
  status: ConsentStatus;
  source: ConsentSource;
  reason?: string;
  messageSid?: string;
  at: string;
}

/** Canonicalise a number the same way the backend does, for lookups. */
export function normalisePhone(phone: string): string {
  const stripped = phone.replace(/[\s\-().]/g, '');
  return stripped.startsWith('+') ? `+${stripped.slice(1)}` : stripped;
}

interface SmsConsentState {
  consents: SmsConsentRecord[];
  events: SmsConsentEvent[];

  /** Replace all records (e.g. after a fresh fetch for the current user). */
  ingest: (records: SmsConsentRecord[]) => void;
  /** Merge a single record and, when supplied, append an audit event. */
  applyConsent: (record: SmsConsentRecord, event?: SmsConsentEvent) => void;
  getByPhone: (phone: string) => SmsConsentRecord | undefined;
  isOptedOut: (phone: string) => boolean;
  historyFor: (phone: string) => SmsConsentEvent[];
  clear: () => void;
}

const sortByUpdatedDesc = (records: SmsConsentRecord[]): SmsConsentRecord[] =>
  [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const useSmsConsentStore = create<SmsConsentState>()(
  persist(
    (set, get) => ({
      consents: [],
      events: [],

      ingest: (records) =>
        set((state) => {
          const byPhone = new Map<string, SmsConsentRecord>();
          for (const record of [...state.consents, ...records]) {
            byPhone.set(normalisePhone(record.phone), record);
          }
          return {
            consents: sortByUpdatedDesc([...byPhone.values()]).slice(0, MAX_CONSENT_ENTRIES),
          };
        }),

      applyConsent: (record, event) =>
        set((state) => {
          const phone = normalisePhone(record.phone);
          const others = state.consents.filter(
            (existing) => normalisePhone(existing.phone) !== phone
          );
          const consents = sortByUpdatedDesc([{ ...record, phone }, ...others]).slice(
            0,
            MAX_CONSENT_ENTRIES
          );
          const events = event
            ? [event, ...state.events].slice(0, MAX_CONSENT_ENTRIES)
            : state.events;
          return { consents, events };
        }),

      getByPhone: (phone) => {
        const target = normalisePhone(phone);
        return get().consents.find((record) => normalisePhone(record.phone) === target);
      },

      isOptedOut: (phone) => get().getByPhone(phone)?.status === 'opted_out',

      historyFor: (phone) => {
        const target = normalisePhone(phone);
        return get()
          .events.filter((event) => normalisePhone(event.phone) === target)
          .sort((a, b) => b.at.localeCompare(a.at));
      },

      clear: () => set({ consents: [], events: [] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({ consents: state.consents, events: state.events }),
      merge: (persistedState: unknown, currentState) => {
        if (!persistedState || typeof persistedState !== 'object') return currentState;
        const persisted = persistedState as Partial<SmsConsentState>;
        return {
          ...currentState,
          consents: persisted.consents ?? currentState.consents,
          events: persisted.events ?? currentState.events,
        };
      },
    }
  )
);
