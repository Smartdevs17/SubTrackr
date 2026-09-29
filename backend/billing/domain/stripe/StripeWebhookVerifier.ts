/**
 * Stripe webhook signature verification (issue #1239).
 *
 * Stripe sends a `Stripe-Signature` header alongside every event:
 *
 * ```
 * Stripe-Signature: t=1614556800,v1=5257a869e7ec…cff6,v0=6ffbb59b2300…
 * ```
 *
 * The signed payload is `"<t>.<rawBody>"`, and the comparison must be
 * constant-time. Three checks are applied before an event is trusted:
 *
 *  1. **Tolerance** — `t` must be within `toleranceSeconds` of now, so a
 *     captured request cannot be replayed later. Stripe's own libraries use 300 s.
 *  2. **Digest** — at least one `v1` signature must match, compared with
 *     `timingSafeEqual`. `v0` signatures are for the *secret*, not the
 *     endpoint secret, and are ignored here on purpose.
 *  3. **Duplicate delivery** — Stripe delivers at-least-once, so an already
 *     processed `event.id` is reported as a duplicate instead of being applied
 *     twice. Ids are held in a bounded in-memory map; a multi-instance
 *     deployment needs a shared store instead (see the note on
 *     `verifyWithStore`).
 *
 * The raw body must be captured verbatim — re-serialising the parsed event
 * changes the bytes and breaks the signature. Use `captureRawBody` from
 * `backend/shared/webhook/webhookVerificationMiddleware.ts`.
 */

import crypto from 'crypto';
import { createLoggerFor } from '../../../services/shared/logging';

const logger = createLoggerFor('billing.stripe.webhook');

export const DEFAULT_STRIPE_TOLERANCE_SECONDS = 300;
export const DEFAULT_STRIPE_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STRIPE_MAX_REMEMBERED_EVENTS = 10_000;

export interface StripeSignatureParts {
  readonly timestamp: number;
  /** The `v1` endpoint-secret signatures. `v0` values are deliberately excluded. */
  readonly signatures: readonly string[];
}

export type StripeVerificationFailure =
  | 'missing_signature'
  | 'malformed_signature'
  | 'missing_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'signature_mismatch'
  | 'missing_event_id';

export interface StripeVerificationOk {
  ok: true;
  eventId: string;
  eventType: string;
  created: number;
  /** False when this event was already applied inside the retention window. */
  fresh: boolean;
  /** The parsed event, when the raw body was valid JSON. */
  event: Record<string, unknown> | null;
}

export interface StripeVerificationError {
  ok: false;
  reason: StripeVerificationFailure;
  message: string;
}

export type StripeVerificationResult = StripeVerificationOk | StripeVerificationError;

export interface StripeWebhookVerifierOptions {
  /** The endpoint signing secret (`whsec_…`), not the API key. */
  readonly secret: string;
  readonly toleranceSeconds?: number;
  readonly eventRetentionMs?: number;
  readonly maxRememberedEvents?: number;
  readonly now?: () => number;
}

export interface StripeEventShape {
  readonly id?: string;
  readonly type?: string;
  readonly created?: number;
}

export class StripeWebhookVerifier {
  private readonly secret: string;
  private readonly toleranceSeconds: number;
  private readonly eventRetentionMs: number;
  private readonly maxRememberedEvents: number;
  private readonly now: () => number;
  private readonly processedEvents = new Map<string, number>();

  constructor(options: StripeWebhookVerifierOptions) {
    const secret = options.secret?.trim();
    if (!secret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required to verify Stripe webhooks');
    }
    this.secret = secret;
    this.toleranceSeconds = Math.max(1, options.toleranceSeconds ?? DEFAULT_STRIPE_TOLERANCE_SECONDS);
    this.eventRetentionMs = Math.max(0, options.eventRetentionMs ?? DEFAULT_STRIPE_EVENT_RETENTION_MS);
    this.maxRememberedEvents = Math.max(
      1,
      options.maxRememberedEvents ?? DEFAULT_STRIPE_MAX_REMEMBERED_EVENTS,
    );
    this.now = options.now ?? Date.now;
  }

  /** Builds a verifier from the environment, or `null` when no secret is set. */
  static fromEnvironment(
    env: Record<string, string | undefined> = process.env,
  ): StripeWebhookVerifier | null {
    const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      logger.info('STRIPE_WEBHOOK_SECRET is not set; Stripe webhooks stay disabled');
      return null;
    }
    const tolerance = Number.parseInt(env.STRIPE_WEBHOOK_TOLERANCE_SECONDS ?? '', 10);
    return new StripeWebhookVerifier({
      secret,
      toleranceSeconds: Number.isFinite(tolerance) ? tolerance : undefined,
    });
  }

  /**
   * Splits a `Stripe-Signature` header. Only `v1` digests are returned: `v0`
   * signs with the webhook secret rather than the endpoint secret and is not a
   * valid endpoint signature.
   */
  parseSignatureHeader(header: string | undefined | null): StripeSignatureParts | null {
    if (!header) return null;

    let timestamp = 0;
    const signatures: string[] = [];

    for (const part of header.split(',')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (!value) continue;
      if (key === 't') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) timestamp = parsed;
      } else if (key === 'v1') {
        signatures.push(value);
      }
    }

    if (!timestamp || signatures.length === 0) return null;
    return { timestamp, signatures };
  }

  /**
   * Verify a delivery.
   *
   * @param rawBody The exact bytes Stripe sent.
   * @param signatureHeader Value of the `Stripe-Signature` header.
   * @param event The already-parsed event, used only for duplicate detection.
   */
  verify(
    rawBody: string,
    signatureHeader: string | undefined | null,
    event: StripeEventShape | null = null,
  ): StripeVerificationResult {
    if (!signatureHeader) {
      return this.fail('missing_signature', 'Stripe-Signature header is absent');
    }

    const parts = this.parseSignatureHeader(signatureHeader);
    if (!parts) {
      return this.fail('malformed_signature', 'Stripe-Signature header is malformed');
    }
    if (!parts.timestamp) {
      return this.fail('missing_timestamp', 'Stripe-Signature header has no usable timestamp');
    }

    const ageSeconds = Math.abs(Math.floor(this.now() / 1000) - parts.timestamp);
    if (ageSeconds > this.toleranceSeconds) {
      logger.warn('Rejected Stripe webhook outside the replay window', { ageSeconds });
      return this.fail(
        'timestamp_out_of_tolerance',
        `Stripe webhook timestamp is ${ageSeconds}s from now (tolerance ${this.toleranceSeconds}s)`,
      );
    }

    // The signed payload is "<t>.<body>", not the body alone.
    if (!this.matchesAny(parts.signatures, `${parts.timestamp}.${rawBody}`)) {
      logger.warn('Rejected Stripe webhook with an invalid digest');
      return this.fail('signature_mismatch', 'Stripe webhook signature does not match the body');
    }

    const eventId = event?.id?.trim();
    if (!eventId) {
      // An event we cannot name cannot be de-duplicated, and Stripe retries
      // until it gets a 2xx, so it would be applied repeatedly.
      return this.fail('missing_event_id', 'Stripe event carries no id, so it cannot be de-duplicated');
    }

    if (this.isDuplicate(eventId)) {
      logger.info('Ignored duplicate Stripe webhook delivery', { eventId });
      return {
        ok: true,
        eventId,
        eventType: event?.type ?? 'unknown',
        created: event?.created ?? parts.timestamp,
        fresh: false,
        event: event as Record<string, unknown> | null,
      };
    }

    this.remember(eventId);
    return {
      ok: true,
      eventId,
      eventType: event?.type ?? 'unknown',
      created: event?.created ?? parts.timestamp,
      fresh: true,
      event: event as Record<string, unknown> | null,
    };
  }

  hasProcessed(eventId: string): boolean {
    return this.isDuplicate(eventId);
  }

  getTrackedEventCount(): number {
    this.prune();
    return this.processedEvents.size;
  }

  reset(): void {
    this.processedEvents.clear();
  }

  private fail(reason: StripeVerificationFailure, message: string): StripeVerificationError {
    return { ok: false, reason, message };
  }

  private matchesAny(signatures: readonly string[], payload: string): boolean {
    const expected = crypto.createHmac('sha256', this.secret).update(payload).digest();
    return signatures.some((signature) => {
      const candidate = Buffer.from(signature, 'hex');
      // timingSafeEqual throws on a length mismatch, so compare lengths first.
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

/** Reads the `Stripe-Signature` header off an Express request. */
export function readStripeSignatureHeader(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = headers['stripe-signature'] ?? headers['Stripe-Signature'];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
