import { createHmac } from 'crypto';
import {
  PaddleWebhookVerifier,
  readPaddleSignatureHeader,
  type PaddleWebhookEvent,
} from '../domain/paddle/PaddleWebhookVerifier';

const SECRET = 'pdl_webhook_secret_test';
const OTHER_SECRET = 'pdl_webhook_secret_other';

const EVENT: PaddleWebhookEvent = {
  event_id: 'evt_01HQ8Z8Y6V3M2N',
  event_type: 'transaction.completed',
  occurred_at: '2026-09-28T10:00:00.000Z',
  notification_id: 'ntf_01HQ8Z8Y6V3M2N',
  data: {
    id: 'txn_01HQ8Z',
    status: 'completed',
    items: [{ price_id: 'pri_7f4c2a91', quantity: 1 }],
    currency_code: 'USD',
  },
};

function serialise(event: PaddleWebhookEvent = EVENT): string {
  return JSON.stringify(event);
}

function sign(payload: string, secret: string = SECRET, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  // Paddle signs "<ts>:<rawBody>" — the header syntax itself is not signed.
  const hmac = createHmac('sha256', secret).update(`${ts}:${payload}`).digest('hex');
  return `ts=${ts};h1=${hmac}`;
}

function createVerifier(overrides: { now?: () => number } = {}): PaddleWebhookVerifier {
  const now = overrides.now ?? (() => Date.now());
  return new PaddleWebhookVerifier({ secret: SECRET, now });
}

describe('PaddleWebhookVerifier', () => {
  describe('configuration', () => {
    it('refuses to build without a secret', () => {
      expect(() => new PaddleWebhookVerifier({ secret: '' })).toThrow('PADDLE_WEBHOOK_SECRET');
      expect(() => new PaddleWebhookVerifier({ secret: '   ' })).toThrow('PADDLE_WEBHOOK_SECRET');
    });

    it('builds from the environment when a secret is present', () => {
      expect(
        PaddleWebhookVerifier.fromEnvironment({ PADDLE_WEBHOOK_SECRET: 'pdl_webhook_secret_test' }),
      ).not.toBeNull();
    });

    it('builds nothing when the secret is absent', () => {
      expect(PaddleWebhookVerifier.fromEnvironment({})).toBeNull();
      expect(
        PaddleWebhookVerifier.fromEnvironment({ PADDLE_WEBHOOK_SECRET: '  ' }),
      ).toBeNull();
    });
  });

  describe('parseSignatureHeader', () => {
    it('parses the timestamp and every digest', () => {
      const parsed = createVerifier().parseSignatureHeader(sign('payload'));

      expect(parsed?.timestamp).toEqual(expect.any(Number));
      expect(parsed?.signatures).toHaveLength(1);
    });

    it('keeps several digests, which a secret rotation produces', () => {
      const parsed = createVerifier().parseSignatureHeader(sign('payload') + ';h1=beef');

      expect(parsed?.signatures).toHaveLength(2);
    });

    it('trims surrounding whitespace', () => {
      const parsed = createVerifier().parseSignatureHeader(`  ${sign('payload')}  `);

      expect(parsed?.signatures[0]).toHaveLength(64);
    });

    it('is case-insensitive on the field names', () => {
      const parsed = createVerifier().parseSignatureHeader('TS=1700000000;H1=abc123');

      expect(parsed).toEqual({ timestamp: 1700000000, signatures: ['abc123'] });
    });

    it('rejects a missing header', () => {
      expect(createVerifier().parseSignatureHeader(undefined)).toBeNull();
      expect(createVerifier().parseSignatureHeader('')).toBeNull();
    });

    it('rejects a non-numeric timestamp', () => {
      expect(createVerifier().parseSignatureHeader('ts=not-a-number;h1=abc')).toBeNull();
    });

    it('rejects a header with no digest', () => {
      expect(createVerifier().parseSignatureHeader('ts=1700000000')).toBeNull();
    });

    it('rejects a header with no separators', () => {
      expect(createVerifier().parseSignatureHeader('tsh1abc')).toBeNull();
    });
  });

  describe('readPaddleSignatureHeader', () => {
    it('reads a plain string header', () => {
      expect(readPaddleSignatureHeader({ 'paddle-signature': 'ts=1;h1=a' })).toBe('ts=1;h1=a');
    });

    it('takes the first entry of a repeated header', () => {
      expect(readPaddleSignatureHeader({ 'paddle-signature': ['ts=1;h1=a', 'ts=2;h1=b'] })).toBe(
        'ts=1;h1=a',
      );
    });

    it('is case-insensitive on the header name', () => {
      expect(readPaddleSignatureHeader({ 'Paddle-Signature': 'ts=1;h1=a' })).toBe('ts=1;h1=a');
    });

    it('returns undefined when the header is absent', () => {
      expect(readPaddleSignatureHeader({})).toBeUndefined();
      expect(readPaddleSignatureHeader({ 'paddle-signature': [] })).toBeUndefined();
    });
  });

  describe('verify', () => {
    it('accepts a correctly signed payload', () => {
      const payload = serialise();
      const result = createVerifier().verify(payload, sign(payload), EVENT);

      expect(result).toEqual({
        ok: true,
        fresh: true,
        eventId: EVENT.event_id,
        eventType: EVENT.event_type,
        occurredAt: EVENT.occurred_at,
        data: EVENT.data,
      });
    });

    it('rejects a payload signed with a different secret', () => {
      const payload = serialise();
      const result = createVerifier().verify(payload, sign(payload, OTHER_SECRET), EVENT);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('signature_mismatch');
      expect(result.message).toContain('Paddle-Signature');
    });

    it('rejects a payload whose body was altered after signing', () => {
      const signed = serialise();
      const tampered = serialise({
        ...EVENT,
        data: { ...(EVENT.data as Record<string, unknown>), status: 'ready' },
      });
      const result = createVerifier().verify(tampered, sign(signed), EVENT);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('signature_mismatch');
    });

    it('rejects a missing signature header', () => {
      const result = createVerifier().verify(serialise(), undefined, EVENT);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_signature');
    });

    it('rejects a malformed signature header', () => {
      const result = createVerifier().verify(serialise(), 'garbage', EVENT);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('malformed_signature');
    });

    it('rejects a timestamp older than the tolerance window', () => {
      const now = 1_800_000_000_000;
      const payload = serialise();
      const stale = Math.floor(now / 1000) - 400;
      const result = createVerifier({ now: () => now }).verify(
        payload,
        sign(payload, SECRET, stale),
        EVENT,
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('timestamp_out_of_tolerance');
    });

    it('accepts a timestamp inside the tolerance window', () => {
      const now = 1_800_000_000_000;
      const payload = serialise();
      const recent = Math.floor(now / 1000) - 30;
      const result = createVerifier({ now: () => now }).verify(
        payload,
        sign(payload, SECRET, recent),
        EVENT,
      );

      expect(result.ok).toBe(true);
    });

    it('honours a widened tolerance', () => {
      const now = 1_800_000_000_000;
      const payload = serialise();
      const old = Math.floor(now / 1000) - 400;
      const verifier = new PaddleWebhookVerifier({
        secret: SECRET,
        toleranceSeconds: 900,
        now: () => now,
      });

      const result = verifier.verify(payload, sign(payload, SECRET, old), EVENT);

      expect(result.ok).toBe(true);
    });

    it('rejects an event with no id, which cannot be de-duplicated', () => {
      const event = { ...EVENT, event_id: '' };
      const payload = serialise(event);
      const result = createVerifier().verify(payload, sign(payload), event);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_event_id');
    });
  });

  describe('replay protection', () => {
    it('treats a redelivered event as not fresh', () => {
      const verifier = createVerifier();
      const payload = serialise();
      const header = sign(payload);

      expect(verifier.verify(payload, header, EVENT).fresh).toBe(true);
      const replay = verifier.verify(payload, header, EVENT);

      expect(replay.ok).toBe(true);
      expect(replay.fresh).toBe(false);
    });

    it('does not de-duplicate different events', () => {
      const verifier = createVerifier();
      const first = serialise();
      verifier.verify(first, sign(first), EVENT);

      const otherEvent = { ...EVENT, event_id: 'evt_02', data: { id: 'txn_02' } };
      const second = serialise(otherEvent);
      const result = verifier.verify(second, sign(second), otherEvent);

      expect(result.fresh).toBe(true);
    });

    it('reports whether an event was already handled', () => {
      const verifier = createVerifier();
      const payload = serialise();
      const header = sign(payload);

      expect(verifier.hasProcessed(EVENT.event_id)).toBe(false);
      verifier.verify(payload, header, EVENT);

      expect(verifier.hasProcessed(EVENT.event_id)).toBe(true);
    });

    it('forgets events older than the retention window', () => {
      let now = 1_800_000_000_000;
      const verifier = new PaddleWebhookVerifier({
        secret: SECRET,
        eventRetentionMs: 1000,
        now: () => now,
      });
      const payload = serialise();
      verifier.verify(payload, sign(payload), EVENT);

      expect(verifier.hasProcessed(EVENT.event_id)).toBe(true);
      now += 2000;
      expect(verifier.hasProcessed(EVENT.event_id)).toBe(false);
    });

    it('stays within its memory bound', () => {
      const verifier = new PaddleWebhookVerifier({ secret: SECRET, maxRememberedEvents: 3 });
      for (let index = 0; index < 10; index += 1) {
        const event = { ...EVENT, event_id: `evt_${index}` };
        const payload = serialise(event);
        verifier.verify(payload, sign(payload), event);
      }

      expect(verifier.getTrackedEventCount()).toBe(3);
    });
  });
});
