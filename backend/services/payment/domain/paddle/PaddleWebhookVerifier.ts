/**
 * Paddle webhook signature verification (issue #1240).
 *
 * Paddle signs every webhook with an HMAC-SHA256 over `"{ts}:{rawBody}"` and
 * sends the result in the `Paddle-Signature` header:
 *
 * ```
 * Paddle-Signature: ts=1671552777;h1=eb4d0dc8853be92b7f063b9f3ba5233eb920a09459b6e6b2c26705b4364db711
 * ```
 *
 * Two independent checks are required before a webhook is trusted:
 *
 *  1. **Freshness** — the timestamp must be inside `toleranceSeconds` of now, so
 *     a captured-and-replayed request dies.
 * 2. **Authenticity** — the hex digest is compared with a constant-time
 *     equality check, so a timing oracle cannot leak the expected digest.
 *
 * Replay is then blocked at the *event* level: Paddle retries a webhook until
 * it is 2xx'd, and a legitimate retry carries the same `event_id`. Processed
 * ids are remembered for `eventRetentionMs` so the second delivery is reported
 * as a duplicate instead of being applied twice.
 *
 * The raw body must be captured verbatim (see `captureRawBody` in
 * `backend/shared/webhook/webhookVerificationMiddleware.ts`): re-serialising a
 * parsed object changes the bytes and breaks the digest.
 */

import crypto from 'crypto';
import { createLoggerFor } from '../../../shared/logging';

const logger = createLoggerFor('payment.paddle.webhook');

/** Paddle documents a 5 minute replay window. */
export const DEFAULT_TOLERANCE_SECONDS = 5 * 60;
/** How long a processed `event_id` is remembered before it may be applied again. */
export const DEFAULT_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Memory bound for the in-memory dedupe cache. */
export const DEFAULT_MAX_REMEMBERED_EVENTS = 10_000;

export interface PaddleSignatureParts {
  timestamp: number;
  signatures: string[];
}

export type PaddleVerificationFailure =
  | 'missing_signature'
  | 'malformed_signature'
  | 'missing_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'signature_mismatch'
  | 'missing_event_id';

export interface PaddleVerificationOk {
  ok: true;
  eventId: string;
  eventType: string;
  occurredAt: string;
  data: unknown;
  /** False when this event was already applied inside the retention window. */
  fresh: boolean;
}

export interface PaddleVerificationError {
  ok: false;
  reason: PaddleVerificationFailure;
  message: string;
}

export type PaddleVerificationResult = PaddleVerificationOk | PaddleVerificationError;

export interface PaddleWebhookVerifierOptions {
  /** Paddle notification secret from Developer tools → Notifications. */
  secret: string;
  /** Replay window in seconds. Defaults to 300. */
  toleranceSeconds?: number;
  /** How long processed event ids are remembered. Defaults to 24 h. */
  eventRetentionMs?: number;
  /**
   * Upper bound on remembered event ids. The dedupe cache is in-memory, so an
   * unbounded map would grow with every notification; the oldest ids are
   * evicted once the limit is hit. Defaults to 10 000.
   */
  maxRememberedEvents?: number;
  /** Injected in tests, so a duplicate check does not wait. Defaults to `Date.now`. */
  now?: () => number;
}

export interface PaddleWebhookEvent {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  /** Paddle's own delivery id, echoed for support/debugging. */
  notification_id?: string;
  data?: unknown;
}

export class PaddleWebhookVerifier {
  private readonly secret: string;
  private readonly toleranceSeconds: number;
  private readonly eventRetentionMs: number;
  private readonly maxRememberedEvents: number;
  private readonly now: () => number;
  private readonly processedEvents = new Map<string, number>();

  constructor(options: PaddleWebhookVerifierOptions) {
    const secret = options.secret?.trim();
    if (!secret) {
      throw new Error('PADDLE_WEBHOOK_SECRET is required to verify Paddle webhooks');
    }
    this.secret = secret;
    this.toleranceSeconds = Math.max(
      1,
      options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS,
    );
    this.eventRetentionMs = Math.max(
      0,
      options.eventRetentionMs ?? DEFAULT_EVENT_RETENTION_MS,
    );
    this.maxRememberedEvents = Math.max(
      1,
      options.maxRememberedEvents ?? DEFAULT_MAX_REMEMBERED_EVENTS,
    );
    this.now = options.now ?? Date.now;
  }

  /**
   * Builds a verifier from the environment, or `null` when no notification
   * secret is configured. The server uses this so a deployment without a
   * Paddle secret does not mount a webhook route that can never verify
   * anything.
   */
  static fromEnvironment(
    env: Record<string, string | undefined> = process.env,
  ): PaddleWebhookVerifier | null {
    const secret = env.PADDLE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      logger.info('PADDLE_WEBHOOK_SECRET is not set; Paddle webhooks stay disabled');
      return null;
    }
    const tolerance = Number.parseInt(env.PADDLE_WEBHOOK_TOLERANCE_SECONDS ?? '', 10);
    return new PaddleWebhookVerifier({
      secret,
      toleranceSeconds: Number.isFinite(tolerance) ? tolerance : undefined,
    });
  }

  /**
   * Split a `Paddle-Signature` header into its timestamp and digests. Several
   * `h1` values may be present during a secret rotation; any match is accepted.
   */
  parseSignatureHeader(header: string | undefined | null): PaddleSignatureParts | null {
    if (!header) return null;

    let timestamp = 0;
    const signatures: string[] = [];

    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      // Paddle sends `ts`/`h1`, but a proxy that rewrites the header casing must
      // not be able to turn a genuine delivery into a rejection.
      const key = part.slice(0, separator).trim().toLowerCase();
      const value = part.slice(separator + 1).trim();
      if (key === 'ts') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) timestamp = parsed;
      } else if (key === 'h1' && value) {
        signatures.push(value);
      }
    }

    if (!timestamp || signatures.length === 0) return null;
    return { timestamp, signatures };
  }

  /**
   * Verify a webhook delivery.
   *
   * @param rawBody The exact bytes Paddle sent (not a re-serialised object).
   * @param signatureHeader Value of the `Paddle-Signature` header.
   * @param event Parsed event payload, used for duplicate detection only.
   */
  verify(
    rawBody: string,
    signatureHeader: string | undefined | null,
    event: PaddleWebhookEvent = {},
  ): PaddleVerificationResult {
    if (!signatureHeader) {
      return this.fail('missing_signature', 'Paddle-Signature header is absent');
    }

    const parts = this.parseSignatureHeader(signatureHeader);
    if (!parts) {
      return this.fail('malformed_signature', 'Paddle-Signature header is malformed');
    }

    const issuedAtSeconds = parts.timestamp;
    if (!issuedAtSeconds) {
      return this.fail('missing_timestamp', 'Paddle-Signature header has no usable timestamp');
    }

    const ageSeconds = Math.abs(Math.floor(this.now() / 1000) - issuedAtSeconds);
    if (ageSeconds > this.toleranceSeconds) {
      logger.warn('Rejected Paddle webhook outside the replay window', { ageSeconds });
      return this.fail(
        'timestamp_out_of_tolerance',
        `Paddle webhook timestamp is ${ageSeconds}s away from now (tolerance ${this.toleranceSeconds}s)`,
      );
    }

    if (!this.matchesAny(parts.signatures, `${issuedAtSeconds}:${rawBody}`)) {
      logger.warn('Rejected Paddle webhook with an invalid digest');
      return this.fail('signature_mismatch', 'Paddle webhook signature does not match the body');
    }

    const eventId = event.event_id?.trim();
    if (!eventId) {
      // Without an id there is nothing to de-duplicate against, and Paddle
      // retries until it gets a 2xx — so an unidentifiable delivery would be
      // applied an unknown number of times.
      return this.fail(
        'missing_event_id',
        'Paddle notification carries no event_id, so it cannot be de-duplicated',
      );
    }

    if (this.isDuplicate(eventId)) {
      logger.info('Ignored duplicate Paddle webhook delivery', { eventId });
      return {
        ok: true,
        eventId,
        eventType: event.event_type ?? 'unknown',
        occurredAt: event.occurred_at ?? new Date(this.now()).toISOString(),
        data: event.data,
        fresh: false,
      };
    }

    this.remember(eventId);

    return {
      ok: true,
      eventId,
      eventType: event.event_type ?? 'unknown',
      occurredAt: event.occurred_at ?? new Date(this.now()).toISOString(),
      data: event.data,
      fresh: true,
    };
  }

  /** Whether an `event_id` was already applied inside the retention window. */
  hasProcessed(eventId: string): boolean {
    return this.isDuplicate(eventId);
  }

  /** Number of event ids currently inside the retention window. */
  getTrackedEventCount(): number {
    this.prune();
    return this.processedEvents.size;
  }

  /** Forget every processed event id, e.g. after a cache flush. */
  reset(): void {
    this.processedEvents.clear();
  }

  private fail(reason: PaddleVerificationFailure, message: string): PaddleVerificationError {
    return { ok: false, reason, message };
  }

  private matchesAny(signatures: string[], payload: string): boolean {
    const expected = crypto.createHmac('sha256', this.secret).update(payload).digest();
    // Length check first: timingSafeEqual throws on a length mismatch, and
    // leaking the digest length through a throw is not a weakness, but keeping
    // the comparison constant-time for equal lengths is.
    return signatures.some((signature) => {
      const candidate = Buffer.from(signature, 'hex');
      if (candidate.length !== expected.length) return false;
      return crypto.timingSafeEqual(candidate, expected);
    });
  }

  private isDuplicate(eventId: string): boolean {
    this.prune();
    return this.processedEvents.has(eventId);
  }

  private remember(eventId: string): void {
    this.processedEvents.set(eventId, this.now() + this.eventRetentionMs);
    while (this.processedEvents.size > this.maxRememberedEvents) {
      // Map iterates in insertion order, so the first key is the oldest.
      const oldest = this.processedEvents.keys().next();
      if (oldest.done) break;
      this.processedEvents.delete(oldest.value);
    }
  }

  private prune(): void {
    const cutoff = this.now();
    for (const [eventId, expiresAt] of this.processedEvents) {
      if (expiresAt <= cutoff) this.processedEvents.delete(eventId);
    }
  }
}

/** Convenience wrapper used by the router: pull the header off a request. */
export function readPaddleSignatureHeader(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = headers['paddle-signature'] ?? headers['Paddle-Signature'];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
