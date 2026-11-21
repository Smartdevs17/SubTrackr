/**
 * SMS consent ledger (#1747)
 *
 * Covers: consent recording with provenance, opt-out honoured by the shared
 * registry, express-opt-in latching, idempotent replays, the append-only audit
 * trail, per-user listing, and phone normalisation.
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  InMemorySmsConsentRepository,
  SmsConsentService,
  normalisePhone,
  type OptOutRegistry,
} from '../smsConsentService';

/** Minimal in-memory stand-in for the shared provider opt-out registry. */
function makeRegistry(): OptOutRegistry & { optedOut: Set<string> } {
  const optedOut = new Set<string>();
  return {
    optedOut,
    optOut: (phone) => void optedOut.add(phone),
    optIn: (phone) => void optedOut.delete(phone),
    isOptedOut: (phone) => optedOut.has(phone),
  };
}

function makeService(now = new Date('2026-01-01T00:00:00.000Z')) {
  const repository = new InMemorySmsConsentRepository();
  const registry = makeRegistry();
  const clock = jest.fn(() => now);
  const service = new SmsConsentService({ repository, optOutRegistry: registry, now: clock });
  return { service, repository, registry, clock };
}

describe('normalisePhone', () => {
  it('strips formatting characters', () => {
    expect(normalisePhone('+1 (555) 000-1111')).toBe('+15550001111');
    expect(normalisePhone('1.555.000.1111')).toBe('15550001111');
  });

  it('preserves a leading plus and nothing else', () => {
    expect(normalisePhone('0015550001111')).toBe('0015550001111');
    expect(normalisePhone('+ 1 555 000 1111')).toBe('+15550001111');
  });
});

describe('SmsConsentService.recordConsent', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it('records a consent decision with its source', async () => {
    const { consent, changed } = await ctx.service.recordConsent({
      phone: '+1 (555) 000-1111',
      status: 'opted_in',
      source: 'web_form',
      userId: 'user-1',
      reason: 'signup checkbox',
    });

    expect(changed).toBe(true);
    expect(consent).toMatchObject({
      phone: '+15550001111',
      status: 'opted_in',
      source: 'web_form',
      userId: 'user-1',
      reason: 'signup checkbox',
      explicitOptIn: true,
    });
    expect(consent.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(consent.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reports changed=false when the status is unchanged', async () => {
    await ctx.service.optOut('+15550001111', 'admin');
    const { changed, consent } = await ctx.service.recordConsent({
      phone: '+15550001111',
      status: 'opted_out',
      source: 'inbound_sms',
    });
    expect(changed).toBe(false);
    expect(consent.status).toBe('opted_out');
  });

  it('always appends an audit event, even for a no-op', async () => {
    await ctx.service.optOut('+15550001111', 'admin');
    await ctx.service.optOut('+15550001111', 'inbound_sms', { messageSid: 'SM9' });
    const events = await ctx.service.listEvents('+15550001111');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ source: 'inbound_sms', messageSid: 'SM9' });
    expect(events[1]).toMatchObject({ source: 'admin' });
  });

  it('keeps the original userId and createdAt across changes', async () => {
    await ctx.service.optIn('+15550001111', 'web_form', { userId: 'user-1' });
    const later = new Date('2026-06-01T00:00:00.000Z');
    ctx.clock.mockReturnValue(later);
    const consent = await ctx.service.optOut('+15550001111', 'inbound_sms');
    expect(consent.userId).toBe('user-1');
    expect(consent.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(consent.updatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('latches explicitOptIn once set by a non-system source', async () => {
    await ctx.service.optIn('+15550001111', 'web_form');
    const afterSystemReset = await ctx.service.recordConsent({
      phone: '+15550001111',
      status: 'opted_out',
      source: 'system',
    });
    expect(afterSystemReset.consent.explicitOptIn).toBe(true);
  });

  it('does not treat a system opt-in as express consent', async () => {
    const consent = await ctx.service.optIn('+15550001111', 'system');
    expect(consent.explicitOptIn).toBe(false);
  });
});

describe('SmsConsentService opt-out honouring', () => {
  it('mirrors an opt-out into the shared registry', async () => {
    const { service, registry } = makeService();
    await service.optOut('+15550001111', 'inbound_sms');
    expect(registry.isOptedOut('+15550001111')).toBe(true);
    expect(await service.isOptedOut('+15550001111')).toBe(true);
  });

  it('clears the shared registry on opt-in', async () => {
    const { service, registry } = makeService();
    await service.optOut('+15550001111', 'inbound_sms');
    await service.optIn('+15550001111', 'inbound_sms');
    expect(registry.isOptedOut('+15550001111')).toBe(false);
    expect(await service.isOptedOut('+15550001111')).toBe(false);
  });

  it('normalises the phone before touching the registry', async () => {
    const { service, registry } = makeService();
    await service.optOut('+1 (555) 000-1111', 'admin');
    expect(registry.isOptedOut('+15550001111')).toBe(true);
    expect(await service.isOptedOut('+1-555-000-1111')).toBe(true);
  });

  it('reports isOptedOut=false for an unknown number', async () => {
    const { service } = makeService();
    expect(await service.isOptedOut('+19999999999')).toBe(false);
  });
});

describe('SmsConsentService lookups', () => {
  it('returns null for an unknown number', async () => {
    const { service } = makeService();
    expect(await service.getConsent('+19999999999')).toBeNull();
  });

  it('lists consent records owned by a user, newest first', async () => {
    const { service, clock } = makeService();
    await service.optIn('+15550001111', 'web_form', { userId: 'user-1' });
    clock.mockReturnValue(new Date('2026-02-01T00:00:00.000Z'));
    await service.optIn('+15550002222', 'web_form', { userId: 'user-1' });
    await service.optIn('+15550003333', 'web_form', { userId: 'user-2' });

    const consents = await service.listForUser('user-1');
    expect(consents.map((c) => c.phone)).toEqual(['+15550002222', '+15550001111']);
  });

  it('caps the audit trail to the requested limit, newest first', async () => {
    const { service } = makeService();
    for (let i = 0; i < 5; i += 1) {
      await service.optOut('+15550001111', 'inbound_sms', { messageSid: `SM${i}` });
    }
    const events = await service.listEvents('+15550001111', 3);
    expect(events.map((e) => e.messageSid)).toEqual(['SM4', 'SM3', 'SM2']);
  });
});
