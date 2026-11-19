/**
 * Unit tests for smsConsentStore.ts (#1747)
 *
 * Covers: ingestion merging, applyConsent upsert + event append, phone
 * normalisation for lookups, the opt-out predicate, per-phone history, ordering
 * and the retention cap.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  useSmsConsentStore,
  normalisePhone,
  MAX_CONSENT_ENTRIES,
  type SmsConsentRecord,
} from '../smsConsentStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const consent = (phone: string, overrides: Partial<SmsConsentRecord> = {}): SmsConsentRecord => ({
  phone,
  status: 'opted_in',
  userId: 'user_1',
  source: 'web_form',
  explicitOptIn: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  useSmsConsentStore.setState({ consents: [], events: [] });
});

describe('normalisePhone', () => {
  it('strips formatting and preserves a leading plus', () => {
    expect(normalisePhone('+1 (555) 000-1111')).toBe('+15550001111');
    expect(normalisePhone('1.555.000.1111')).toBe('15550001111');
  });
});

describe('useSmsConsentStore.ingest', () => {
  it('adds records and sorts newest first', () => {
    useSmsConsentStore
      .getState()
      .ingest([
        consent('+15550001111', { updatedAt: '2026-01-01T00:00:00.000Z' }),
        consent('+15550002222', { updatedAt: '2026-02-01T00:00:00.000Z' }),
      ]);
    const { consents } = useSmsConsentStore.getState();
    expect(consents.map((c) => c.phone)).toEqual(['+15550002222', '+15550001111']);
  });

  it('merges by normalised phone, keeping the newer record', () => {
    useSmsConsentStore.getState().ingest([consent('+1 (555) 000-1111')]);
    useSmsConsentStore.getState().ingest([
      consent('+15550001111', {
        status: 'opted_out',
        source: 'inbound_sms',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }),
    ]);
    const { consents } = useSmsConsentStore.getState();
    expect(consents).toHaveLength(1);
    expect(consents[0].status).toBe('opted_out');
  });

  it('caps the number of retained records', () => {
    const many = Array.from({ length: MAX_CONSENT_ENTRIES + 20 }, (_, i) =>
      consent(`+1555000${String(i).padStart(4, '0')}`)
    );
    useSmsConsentStore.getState().ingest(many);
    expect(useSmsConsentStore.getState().consents).toHaveLength(MAX_CONSENT_ENTRIES);
  });
});

describe('useSmsConsentStore.applyConsent', () => {
  it('upserts a record and appends its audit event', () => {
    useSmsConsentStore
      .getState()
      .applyConsent(consent('+15550001111', { status: 'opted_out', source: 'admin' }), {
        phone: '+15550001111',
        userId: 'user_1',
        status: 'opted_out',
        source: 'admin',
        reason: 'requested',
        at: '2026-03-01T00:00:00.000Z',
      });
    const state = useSmsConsentStore.getState();
    expect(state.consents).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.isOptedOut('+15550001111')).toBe(true);
  });

  it('replaces an existing record for the same number', () => {
    useSmsConsentStore.getState().ingest([consent('+15550001111')]);
    useSmsConsentStore
      .getState()
      .applyConsent(
        consent('+1 (555) 000-1111', { status: 'opted_out', updatedAt: '2026-04-01T00:00:00.000Z' })
      );
    expect(useSmsConsentStore.getState().consents).toHaveLength(1);
    expect(useSmsConsentStore.getState().consents[0].status).toBe('opted_out');
  });

  it('leaves the event log untouched when no event is supplied', () => {
    useSmsConsentStore.getState().applyConsent(consent('+15550001111'));
    expect(useSmsConsentStore.getState().events).toHaveLength(0);
  });
});

describe('useSmsConsentStore lookups', () => {
  beforeEach(() => {
    useSmsConsentStore.getState().ingest([consent('+1 (555) 000-1111')]);
  });

  it('finds a record by un-normalised phone', () => {
    expect(useSmsConsentStore.getState().getByPhone('+15550001111')).toBeDefined();
    expect(useSmsConsentStore.getState().getByPhone('+1-555-000-1111')?.status).toBe('opted_in');
  });

  it('reports opted-out only for opted-out numbers', () => {
    expect(useSmsConsentStore.getState().isOptedOut('+15550001111')).toBe(false);
    expect(useSmsConsentStore.getState().isOptedOut('+19999999999')).toBe(false);
  });

  it('returns per-phone history newest first', () => {
    useSmsConsentStore.setState({
      events: [
        {
          phone: '+15550001111',
          userId: null,
          status: 'opted_in',
          source: 'web_form',
          at: '2026-01-01T00:00:00.000Z',
        },
        {
          phone: '+15550001111',
          userId: null,
          status: 'opted_out',
          source: 'inbound_sms',
          at: '2026-02-01T00:00:00.000Z',
        },
        {
          phone: '+15550002222',
          userId: null,
          status: 'opted_in',
          source: 'web_form',
          at: '2026-03-01T00:00:00.000Z',
        },
      ],
    });
    const history = useSmsConsentStore.getState().historyFor('+1-555-000-1111');
    expect(history.map((e) => e.status)).toEqual(['opted_out', 'opted_in']);
  });

  it('clears state', () => {
    useSmsConsentStore.getState().clear();
    expect(useSmsConsentStore.getState().consents).toHaveLength(0);
    expect(useSmsConsentStore.getState().events).toHaveLength(0);
  });
});
