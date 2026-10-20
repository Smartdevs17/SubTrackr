import { createHmac } from 'crypto';
import {
  DEFAULT_STRIPE_TOLERANCE_SECONDS,
  StripeWebhookVerifier,
  readStripeSignatureHeader,
  type StripeEventShape,
} from '../domain/stripe/StripeWebhookVerifier';

const SECRET = 'whsec_test_endpoint_secret';
const OTHER_SECRET = 'whsec_test_other_secret';

const EVENT: StripeEventShape = {
  id: 'evt_1H8ZQ8Y6V3M2N',
  type: 'invoice.paid',
  created: 1_800_000_000,
};

function body(): string {
  return JSON.stringify({ id: EVENT.id, object: 'event', type: EVENT.type, data: { object: { id: 'in_1' } } });
}

function sign(payload: string, secret: string = SECRET, timestamp = 1_800_000_000): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function createVerifier(
  overrides: { now?: () => number; toleranceSeconds?: number; eventRetentionMs?: number; maxRememberedEvents?: number } = {},
): StripeWebhookVerifier {
  return new StripeWebhookVerifier({
    secret: SECRET,
    now: overrides.now ?? (() => 1_800_000_000_000),
    toleranceSeconds: overrides.toleranceSeconds,
    eventRetentionMs: overrides.eventRetentionMs,
    maxRememberedEvents: overrides.maxRememberedEvents,
  });
}

describe('StripeWebhookVerifier', () => {
  describe('configuration', () => {
    it('refuses to build without an endpoint secret', () => {
      expect(() => new StripeWebhookVerifier({ secret: '' })).toThrow('STRIPE_WEBHOOK_SECRET');
      expect(() => new StripeWebhookVerifier({ secret: '   ' })).toThrow('STRIPE_WEBHOOK_SECRET');
    });

    it('builds from the environment when a secret is present', () => {
      expect(
        StripeWebhookVerifier.fromEnvironment({ STRIPE_WEBHOOK_SECRET: 'whsec_test' }),
      ).not.toBeNull();
    });

    it('builds nothing without a secret', () => {
      expect(StripeWebhookVerifier.fromEnvironment({})).toBeNull();
      expect(StripeWebhookVerifier.fromEnvironment({ STRIPE_WEBHOOK_SECRET: ' ' })).toBeNull();
    });

    it('defaults to a five minute tolerance', () => {
      expect(DEFAULT_STRIPE_TOLERANCE_SECONDS).toBe(300);
    });
  });

  describe('parseSignatureHeader', () => {
    it('parses the timestamp and the v1 digest', () => {
      const parsed = createVerifier().parseSignatureHeader(sign(body()));

      expect(parsed?.timestamp).toBe(1_800_000_000);
      expect(parsed?.signatures).toHaveLength(1);
    });

    it('accepts several v1 digests, which a secret rotation produces', () => {
      const parsed = createVerifier().parseSignatureHeader(`${sign(body())},v1=deadbeef`);

      expect(parsed?.signatures).toHaveLength(2);
    });

    it('ignores v0 signatures, which do not use the endpoint secret', () => {
      const parsed = createVerifier().parseSignatureHeader('t=1800000000,v0=abcdef');

      expect(parsed).toBeNull();
    });

    it('keeps the v1 digest when a v0 digest is also present', () => {
      const v1 = sign(body()).split('v1=')[1];
      const parsed = createVerifier().parseSignatureHeader(`t=1800000000,v0=abcdef,v1=${v1}`);

      expect(parsed?.signatures).toEqual([v1]);
    });

    it('rejects a missing or malformed header', () => {
      expect(createVerifier().parseSignatureHeader(undefined)).toBeNull();
      expect(createVerifier().parseSignatureHeader('')).toBeNull();
      expect(createVerifier().parseSignatureHeader('garbage')).toBeNull();
      expect(createVerifier().parseSignatureHeader('t=notanumber,v1=abc')).toBeNull();
      expect(createVerifier().parseSignatureHeader('t=1800000000')).toBeNull();
    });
  });

  describe('readStripeSignatureHeader', () => {
    it('reads a plain string header', () => {
      expect(readStripeSignatureHeader({ 'stripe-signature': 't=1,v1=a' })).toBe('t=1,v1=a');
    });

    it('takes the first entry of a repeated header', () => {
      expect(readStripeSignatureHeader({ 'stripe-signature': ['t=1,v1=a', 't=2,v1=b'] })).toBe(
        't=1,v1=a',
      );
    });

    it('is case-insensitive on the header name', () => {
      expect(readStripeSignatureHeader({ 'Stripe-Signature': 't=1,v1=a' })).toBe('t=1,v1=a');
    });

    it('returns undefined when the header is absent', () => {
      expect(readStripeSignatureHeader({})).toBeUndefined();
      expect(readStripeSignatureHeader({ 'stripe-signature': [] })).toBeUndefined();
    });
  });

  describe('verify', () => {
    it('accepts a correctly signed delivery', () => {
      const payload = body();
      const result = createVerifier().verify(payload, sign(payload), JSON.parse(payload));

      expect(result).toEqual({
        ok: true,
        eventId: EVENT.id,
        eventType: 'invoice.paid',
        created: 1_800_000_000,
        fresh: true,
        event: JSON.parse(payload),
      });
    });

    it('rejects a delivery signed with a different secret', () => {
      const payload = body();
      const result = createVerifier().verify(payload, sign(payload, OTHER_SECRET), EVENT);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('signature_mismatch');
    });

    it('rejects a body altered after signing', () => {
      const signed = body();
      const tampered = JSON.stringify({ id: EVENT.id, type: 'invoice.payment_failed' });
      const result = createVerifier().verify(tampered, sign(signed), EVENT);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('signature_mismatch');
    });

    it('signs the timestamp together with the body, not the body alone', () => {
      const payload = body();
      // A digest computed over the body only must not be accepted.
      const wrong = createHmac('sha256', SECRET).update(payload).digest('hex');

      const result = createVerifier().verify(
        payload,
        `t=1800000000,v1=${wrong}`,
        EVENT,
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('signature_mismatch');
    });

    it('rejects a missing signature header', () => {
      const result = createVerifier().verify(body(), undefined, EVENT);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_signature');
    });

    it('rejects a malformed signature header', () => {
      const result = createVerifier().verify(body(), 'nonsense', EVENT);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('malformed_signature');
    });

    it('rejects a timestamp outside the tolerance window', () => {
      const now = 1_800_000_000_000;
      const payload = body();
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
      const payload = body();
      const result = createVerifier({ now: () => now }).verify(
        payload,
        sign(payload, SECRET, Math.floor(now / 1000) - 60),
        EVENT,
      );

      expect(result.ok).toBe(true);
    });

    it('honours a widened tolerance', () => {
      const now = 1_800_000_000_000;
      const payload = body();
      const result = createVerifier({ now: () => now, toleranceSeconds: 900 }).verify(
        payload,
        sign(payload, SECRET, Math.floor(now / 1000) - 400),
        EVENT,
      );

      expect(result.ok).toBe(true);
    });

    it('rejects an event with no id, which cannot be de-duplicated', () => {
      const payload = body();
      const result = createVerifier().verify(payload, sign(payload), { type: 'invoice.paid' });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_event_id');
    });

    it('rejects an unparsed event body', () => {
      const payload = body();
      const result = createVerifier().verify(payload, sign(payload), null);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing_event_id');
    });

    it('falls back to the header timestamp when the event has no created', () => {
      const payload = body();
      const result = createVerifier().verify(payload, sign(payload), { id: 'evt_1' });

      expect(result.ok).toBe(true);
      expect(result.ok && result.created).toBe(1_800_000_000);
    });
  });

  describe('replay protection', () => {
    it('reports a redelivery as a duplicate', () => {
      const verifier = createVerifier();
      const payload = body();
      const header = sign(payload);

      expect(verifier.verify(payload, header, EVENT).fresh).toBe(true);
      const replay = verifier.verify(payload, header, EVENT);

      expect(replay.ok).toBe(true);
      expect(replay.fresh).toBe(false);
    });

    it('still verifies the signature of a duplicate before reporting it', () => {
      const verifier = createVerifier();
      const payload = body();
      verifier.verify(payload, sign(payload), EVENT);

      const replay = verifier.verify(payload, sign(payload, OTHER_SECRET), EVENT);

      expect(replay.ok).toBe(false);
      expect(replay.reason).toBe('signature_mismatch');
    });

    it('does not de-duplicate different events', () => {
      const verifier = createVerifier();
      const payload = body();
      verifier.verify(payload, sign(payload), EVENT);

      const other = verifier.verify(payload, sign(payload), {
        id: 'evt_2',
        type: 'invoice.paid',
      });

      expect(other.fresh).toBe(true);
    });

    it('reports whether an event was already handled', () => {
      const verifier = createVerifier();
      const payload = body();

      expect(verifier.hasProcessed(EVENT.id!)).toBe(false);
      verifier.verify(payload, sign(payload), EVENT);
      expect(verifier.hasProcessed(EVENT.id!)).toBe(true);
    });

    it('forgets events past the retention window', () => {
      let now = 1_800_000_000_000;
      const verifier = createVerifier({ now: () => now, eventRetentionMs: 1000 });
      const payload = body();
      verifier.verify(payload, sign(payload), EVENT);

      expect(verifier.hasProcessed(EVENT.id!)).toBe(true);
      now += 2000;
      expect(verifier.hasProcessed(EVENT.id!)).toBe(false);
    });

    it('stays within its memory bound', () => {
      const verifier = createVerifier({ maxRememberedEvents: 3 });
      const payload = body();
      for (let index = 0; index < 10; index += 1) {
        verifier.verify(payload, sign(payload), { id: `evt_${index}`, type: 'invoice.paid' });
      }

      expect(verifier.getTrackedEventCount()).toBe(3);
    });

    it('can be reset', () => {
      const verifier = createVerifier();
      const payload = body();
      verifier.verify(payload, sign(payload), EVENT);

      verifier.reset();

      expect(verifier.getTrackedEventCount()).toBe(0);
    });
  });
});
