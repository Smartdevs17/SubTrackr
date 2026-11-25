/**
 * backend/src/gateways/circle.ts
 *
 * Circle USDC billing adapter with webhook reconciliation.
 *
 *   - `createCircleAdapter` creates and fetches USDC payments. Amounts are
 *     integer micro-USDC (6 decimals) inside SubTrackr and decimal strings on
 *     the wire; no floats cross the boundary. Creates are retried with the
 *     SAME idempotency key on 429/5xx/transport errors.
 *   - `verifyCircleWebhook` checks Circle's ECDSA-SHA256 signature over the raw
 *     body against the public key identified by `X-Circle-Key-Id`.
 *   - `applyCircleEvent` folds a webhook into a `CircleLedger` idempotently
 *     (by notification id) and only ever moves a payment forward.
 *   - `reconcileCirclePayments` polls Circle for payments whose webhook never
 *     arrived and reports amount mismatches instead of silently overwriting.
 */

import crypto from 'crypto';
import {
  BillingAdapterError,
  noopBillingTelemetry,
  withIdempotentRetry,
  type BillingOperation,
  type BillingTelemetry,
  type BillingTransport,
  type BillingTransportResponse,
  type RetryPolicy,
} from './billingAdapter';

// ── Types ─────────────────────────────────────────────────────────────────────

export const USDC_DECIMALS = 6;
export const CIRCLE_SIGNATURE_HEADER = 'x-circle-signature';
export const CIRCLE_KEY_ID_HEADER = 'x-circle-key-id';

export type CirclePaymentStatus = 'pending' | 'confirmed' | 'paid' | 'failed';

export interface CirclePayment {
  paymentId: string;
  status: CirclePaymentStatus;
  /** Integer micro-USDC (1 USDC = 1_000_000). */
  amountMicro: number;
  createdAt: string;
}

export interface CircleCreatePaymentRequest {
  idempotencyKey: string;
  /** Integer micro-USDC, > 0. */
  amountMicro: number;
  /** Circle source (wallet/card) id. */
  sourceId: string;
  sourceType?: 'wallet' | 'card';
  metadata?: Record<string, string>;
}

export interface CircleAdapter {
  createPayment(request: CircleCreatePaymentRequest): Promise<CirclePayment>;
  fetchPayment(paymentId: string): Promise<CirclePayment>;
}

export interface CircleAdapterOptions {
  transport: BillingTransport;
  telemetry?: BillingTelemetry;
  retry?: RetryPolicy;
  now?: () => number;
}

// ── Amount conversion ─────────────────────────────────────────────────────────

/** 1_500_000 → "1.500000". Integer math only. */
export function microToDecimalString(amountMicro: number): string {
  const whole = Math.trunc(amountMicro / 10 ** USDC_DECIMALS);
  const frac = String(amountMicro % 10 ** USDC_DECIMALS).padStart(USDC_DECIMALS, '0');
  return `${whole}.${frac}`;
}

/** "1.5" → 1_500_000. Rejects anything with more than 6 decimals or non-numeric text. */
export function decimalStringToMicro(value: unknown): number {
  const match = typeof value === 'string' ? /^(\d+)(?:\.(\d{1,6}))?$/.exec(value) : null;
  if (!match) {
    throw new BillingAdapterError('INVALID_RESPONSE', 'circle', 'Circle returned an invalid USDC amount');
  }
  const micro = Number(match[1]) * 10 ** USDC_DECIMALS + Number((match[2] ?? '').padEnd(USDC_DECIMALS, '0'));
  if (!Number.isSafeInteger(micro)) {
    throw new BillingAdapterError('INVALID_RESPONSE', 'circle', 'Circle returned an out-of-range USDC amount');
  }
  return micro;
}

// ── Payment parsing ───────────────────────────────────────────────────────────

export function normaliseCircleStatus(status: unknown): CirclePaymentStatus {
  switch (status) {
    case 'paid':
    case 'complete':
    case 'completed':
      return 'paid';
    case 'confirmed':
      return 'confirmed';
    case 'failed':
    case 'canceled':
    case 'cancelled':
      return 'failed';
    default:
      return 'pending';
  }
}

function parsePayment(raw: unknown): CirclePayment {
  const body = ((raw as Record<string, unknown> | undefined)?.data ?? raw) as Record<string, unknown> | undefined;
  const amount = body?.amount as Record<string, unknown> | undefined;
  if (!body || typeof body.id !== 'string' || body.id === '') {
    throw new BillingAdapterError('INVALID_RESPONSE', 'circle', 'Circle response is missing the payment id');
  }
  if (typeof body.createdAt !== 'string' && typeof body.createDate !== 'string') {
    throw new BillingAdapterError('INVALID_RESPONSE', 'circle', 'Circle response is missing the creation time');
  }
  return {
    paymentId: body.id,
    status: normaliseCircleStatus(body.status),
    amountMicro: decimalStringToMicro(amount?.amount),
    createdAt: (body.createdAt ?? body.createDate) as string,
  };
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export function createCircleAdapter(options: CircleAdapterOptions): CircleAdapter {
  const telemetry = options.telemetry ?? noopBillingTelemetry;
  const now = options.now ?? (() => Date.now());

  const send = (
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    withIdempotentRetry(async () => {
      let response: BillingTransportResponse;
      try {
        response = await options.transport.request({
          method,
          path,
          body,
          idempotencyKey: body?.idempotencyKey as string | undefined,
        });
      } catch (error) {
        throw new BillingAdapterError('PROVIDER_UNAVAILABLE', 'circle', 'Circle transport failed', true, error);
      }
      if (response.status >= 200 && response.status < 300) return response.body;
      const message =
        typeof response.body?.message === 'string' ? response.body.message : 'Circle rejected the request';
      if (response.status === 429) throw new BillingAdapterError('RATE_LIMITED', 'circle', message, true);
      if (response.status >= 500) throw new BillingAdapterError('PROVIDER_UNAVAILABLE', 'circle', message, true);
      throw new BillingAdapterError(response.status === 404 ? 'UNKNOWN' : 'PROVIDER_REJECTED', 'circle', message);
    }, options.retry);

  const observe = async <T>(operation: BillingOperation, fn: () => Promise<T>): Promise<T> => {
    const started = now();
    try {
      const result = await fn();
      telemetry.record({ operation, provider: 'circle', outcome: 'success', durationMs: now() - started });
      return result;
    } catch (error) {
      telemetry.record({
        operation,
        provider: 'circle',
        outcome: 'failure',
        durationMs: now() - started,
        errorCode: error instanceof BillingAdapterError ? error.code : 'UNKNOWN',
      });
      throw error;
    }
  };

  return {
    createPayment: (request) =>
      observe('charge', async () => {
        if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.trim() === '') {
          throw new BillingAdapterError('INVALID_REQUEST', 'circle', 'idempotencyKey is required');
        }
        if (!Number.isSafeInteger(request.amountMicro) || request.amountMicro <= 0) {
          throw new BillingAdapterError('INVALID_REQUEST', 'circle', 'amountMicro must be a positive integer');
        }
        if (!request.sourceId) {
          throw new BillingAdapterError('INVALID_REQUEST', 'circle', 'sourceId is required');
        }
        return parsePayment(
          await send('POST', '/v1/payments', {
            idempotencyKey: request.idempotencyKey,
            amount: { amount: microToDecimalString(request.amountMicro), currency: 'USD' },
            source: { id: request.sourceId, type: request.sourceType ?? 'wallet' },
            metadata: request.metadata,
          }),
        );
      }),

    fetchPayment: (paymentId) =>
      observe('fetch', async () => {
        if (!paymentId) throw new BillingAdapterError('INVALID_REQUEST', 'circle', 'paymentId is required');
        return parsePayment(await send('GET', `/v1/payments/${encodeURIComponent(paymentId)}`));
      }),
  };
}

// ── Webhook verification ──────────────────────────────────────────────────────

export interface CircleWebhookVerifyResult {
  valid: boolean;
  error?: string;
  keyId?: string;
}

/**
 * Verify a Circle webhook. `resolvePublicKey` maps `X-Circle-Key-Id` to a PEM
 * (or SPKI) public key; return undefined for unknown ids, which are rejected.
 */
export function verifyCircleWebhook(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  resolvePublicKey: (keyId: string) => string | undefined,
): CircleWebhookVerifyResult {
  const pick = (name: string) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const signature = pick(CIRCLE_SIGNATURE_HEADER);
  const keyId = pick(CIRCLE_KEY_ID_HEADER);
  if (!signature) return { valid: false, error: `Missing ${CIRCLE_SIGNATURE_HEADER} header` };
  if (!keyId) return { valid: false, error: `Missing ${CIRCLE_KEY_ID_HEADER} header` };
  const publicKey = resolvePublicKey(keyId);
  if (!publicKey) return { valid: false, error: 'Unknown signing key id', keyId };
  try {
    const ok = crypto.verify(
      'sha256',
      Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
    return ok ? { valid: true, keyId } : { valid: false, error: 'Signature verification failed', keyId };
  } catch {
    return { valid: false, error: 'Signature verification failed', keyId };
  }
}

// ── Ledger + webhook application ──────────────────────────────────────────────

export interface CircleLedgerEntry {
  paymentId: string;
  status: CirclePaymentStatus;
  /** What SubTrackr expects to receive, integer micro-USDC. */
  expectedAmountMicro: number;
  /** ISO time the entry was created or last changed. */
  updatedAt: string;
}

export interface CircleLedger {
  get(paymentId: string): Promise<CircleLedgerEntry | undefined>;
  put(entry: CircleLedgerEntry): Promise<void>;
  /** Entries still `pending`/`confirmed` and not updated since `before` (ISO). */
  listUnsettled(before: string): Promise<CircleLedgerEntry[]>;
  /** Returns true the first time a notification id is seen. */
  markNotification(notificationId: string): Promise<boolean>;
}

export class InMemoryCircleLedger implements CircleLedger {
  private readonly entries = new Map<string, CircleLedgerEntry>();
  private readonly seen = new Set<string>();

  async get(paymentId: string) {
    return this.entries.get(paymentId);
  }
  async put(entry: CircleLedgerEntry) {
    this.entries.set(entry.paymentId, { ...entry });
  }
  async listUnsettled(before: string) {
    return [...this.entries.values()].filter(
      (e) => (e.status === 'pending' || e.status === 'confirmed') && e.updatedAt <= before,
    );
  }
  async markNotification(notificationId: string) {
    if (this.seen.has(notificationId)) return false;
    this.seen.add(notificationId);
    return true;
  }
}

export interface CircleWebhookEvent {
  notificationId: string;
  payment: CirclePayment;
}

export type CircleApplyOutcome =
  | 'applied'
  | 'duplicate'
  | 'ignored_stale'
  | 'unknown_payment'
  | 'amount_mismatch';

export interface CircleReconcileLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

const noopLogger: CircleReconcileLogger = { info: () => undefined, warn: () => undefined };

const RANK: Record<CirclePaymentStatus, number> = { pending: 0, confirmed: 1, paid: 2, failed: 2 };

/**
 * Apply one webhook event. Safe to call repeatedly with the same event, and
 * with events delivered out of order: statuses only move forward and terminal
 * statuses (`paid`/`failed`) are never overwritten.
 */
export async function applyCircleEvent(
  ledger: CircleLedger,
  event: CircleWebhookEvent,
  logger: CircleReconcileLogger = noopLogger,
  now: () => string = () => new Date().toISOString(),
): Promise<CircleApplyOutcome> {
  if (!event.notificationId) {
    throw new BillingAdapterError('INVALID_REQUEST', 'circle', 'notificationId is required');
  }
  if (!(await ledger.markNotification(event.notificationId))) return 'duplicate';

  const entry = await ledger.get(event.payment.paymentId);
  if (!entry) {
    logger.warn('[circle] webhook for unknown payment', { paymentId: event.payment.paymentId });
    return 'unknown_payment';
  }
  if (entry.expectedAmountMicro !== event.payment.amountMicro) {
    logger.warn('[circle] amount mismatch', {
      paymentId: entry.paymentId,
      expected: entry.expectedAmountMicro,
      received: event.payment.amountMicro,
    });
    return 'amount_mismatch';
  }
  if (RANK[event.payment.status] <= RANK[entry.status]) return 'ignored_stale';

  await ledger.put({ ...entry, status: event.payment.status, updatedAt: now() });
  logger.info('[circle] payment updated', {
    paymentId: entry.paymentId,
    from: entry.status,
    to: event.payment.status,
  });
  return 'applied';
}

// ── Reconciliation ────────────────────────────────────────────────────────────

export interface CircleReconcileReport {
  checked: number;
  updated: string[];
  mismatched: string[];
  errors: Array<{ paymentId: string; error: string }>;
}

/**
 * Poll Circle for payments that are still unsettled after `staleAfterMs`
 * (their webhook was lost or delayed) and bring the ledger up to date.
 * One failing lookup never aborts the sweep.
 */
export async function reconcileCirclePayments(options: {
  ledger: CircleLedger;
  adapter: CircleAdapter;
  staleAfterMs: number;
  nowMs?: number;
  logger?: CircleReconcileLogger;
}): Promise<CircleReconcileReport> {
  const logger = options.logger ?? noopLogger;
  const nowMs = options.nowMs ?? Date.now();
  const unsettled = await options.ledger.listUnsettled(new Date(nowMs - options.staleAfterMs).toISOString());
  const report: CircleReconcileReport = { checked: unsettled.length, updated: [], mismatched: [], errors: [] };

  for (const entry of unsettled) {
    try {
      const payment = await options.adapter.fetchPayment(entry.paymentId);
      if (payment.amountMicro !== entry.expectedAmountMicro) {
        report.mismatched.push(entry.paymentId);
        logger.warn('[circle] reconciliation amount mismatch', {
          paymentId: entry.paymentId,
          expected: entry.expectedAmountMicro,
          received: payment.amountMicro,
        });
        continue;
      }
      if (RANK[payment.status] > RANK[entry.status]) {
        await options.ledger.put({ ...entry, status: payment.status, updatedAt: new Date(nowMs).toISOString() });
        report.updated.push(entry.paymentId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push({ paymentId: entry.paymentId, error: message });
      logger.warn('[circle] reconciliation lookup failed', { paymentId: entry.paymentId, error: message });
    }
  }
  logger.info('[circle] reconciliation complete', {
    checked: report.checked,
    updated: report.updated.length,
    mismatched: report.mismatched.length,
    errors: report.errors.length,
  });
  return report;
}
