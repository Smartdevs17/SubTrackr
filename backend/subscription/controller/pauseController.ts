/**
 * Pause/resume controller with billing adjustment (Issue #1116).
 *
 *   POST /subscriptions/:id/pause          – pause and issue a credit
 *   POST /subscriptions/:id/pause/preview  – dry-run the billing adjustment
 *   POST /subscriptions/:id/pause/resume   – resume (optionally early)
 *   GET  /subscriptions/:id/pause          – active pause + history
 */

import { fail, ok, type ApiResponse } from '../../services/shared/apiResponse';
import {
  buildPauseBillingAdjustment,
  calculateResumeCredit,
  getPeriodDays,
  daysBetween,
  type PauseReason,
} from '../../domain/pauseBilling';
import { pauseStateStore, type PauseSession } from '../../domain/pauseStateStore';

export interface PauseRequestBody {
  price?: number;
  currency?: string;
  billingCycle?: string;
  periodDays?: number;
  pauseDays?: number;
  reason?: PauseReason;
  note?: string;
}

export interface ResumeRequestBody {
  early?: boolean;
}

export interface PauseView {
  session: PauseSession;
  /** Billing adjustment produced when the pause was created. */
  adjustment: PauseSession['adjustment'];
  /** Credit refunded to the customer on an early resume. */
  earlyResumeCredit: number;
}

export type PauseOutcome<T = PauseView> =
  | { ok: true; status: number; response: ApiResponse<T> }
  | { ok: false; status: number; response: ApiResponse<never> };

/** Dry-run response: what a pause would charge/credit right now. */
export interface PausePreviewView {
  adjustment: PauseSession['adjustment'];
  earlyResumeCredit: number;
  scheduledResumeAt: string;
}

/** Active pause (if any) plus the full pause history for a subscription. */
export interface PauseStateView {
  active: PauseSession | null;
  history: PauseSession[];
}

const VALID_REASONS: PauseReason[] = ['vacation', 'financial_hardship', 'temporary_need', 'other'];

type PauseSuccess = Extract<PauseOutcome, { ok: true }>;

function success<T>(data: T, requestId?: string): { ok: true; status: number; response: ApiResponse<T> } {
  return { ok: true, status: 200, response: ok(data, requestId) };
}

function error(
  code: Parameters<typeof fail>[0],
  message: string,
  status: number,
  requestId?: string
): { ok: false; status: number; response: ApiResponse<never> } {
  return { ok: false, status, response: fail(code, message, requestId) };
}

function resolvePeriodDays(body: PauseRequestBody): number {
  if (typeof body.periodDays === 'number' && body.periodDays > 0) return body.periodDays;
  return getPeriodDays(body.billingCycle ?? 'monthly');
}

function toView(session: PauseSession): PauseSuccess {
  const daysElapsed = daysBetween(session.pausedAt);
  const early = calculateResumeCredit({
    creditAmount: session.adjustment.creditAmount,
    pauseDays: session.pauseDays,
    daysElapsed,
  });
  return success({
    session,
    adjustment: session.adjustment,
    earlyResumeCredit: early.creditRefund,
  });
}

/** POST /subscriptions/:id/pause */
export function pauseSubscription(
  subscriptionId: string,
  body: PauseRequestBody,
  requestId?: string
): PauseOutcome {
  if (!subscriptionId?.trim()) {
    return error('BAD_REQUEST', 'Subscription id is required', 400, requestId);
  }
  if (typeof body?.price !== 'number' || !Number.isFinite(body.price) || body.price < 0) {
    return error('VALIDATION_ERROR', 'Body must include a non-negative numeric "price"', 422, requestId);
  }
  if (typeof body?.pauseDays !== 'number') {
    return error('VALIDATION_ERROR', 'Body must include numeric "pauseDays"', 422, requestId);
  }
  const reason = body.reason ?? 'other';
  if (!VALID_REASONS.includes(reason)) {
    return error(
      'VALIDATION_ERROR',
      `reason must be one of: ${VALID_REASONS.join(', ')}`,
      422,
      requestId
    );
  }

  try {
    const session = pauseStateStore.pause({
      subscriptionId,
      price: body.price,
      currency: body.currency ?? 'USD',
      periodDays: resolvePeriodDays(body),
      pauseDays: body.pauseDays,
      reason,
      note: body.note,
    });
    const view = toView(session);
    return { ...view, status: 201 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to pause subscription';
    const code = message.includes('already paused') ? 'SUBSCRIPTION_PAUSED' : 'VALIDATION_ERROR';
    return error(code, message, code === 'SUBSCRIPTION_PAUSED' ? 409 : 422, requestId);
  }
}

/** POST /subscriptions/:id/pause/preview */
export function previewPause(
  subscriptionId: string,
  body: PauseRequestBody,
  requestId?: string
): PauseOutcome<PausePreviewView> {
  if (typeof body?.price !== 'number' || typeof body?.pauseDays !== 'number') {
    return error(
      'VALIDATION_ERROR',
      'Body must include numeric "price" and "pauseDays"',
      422,
      requestId
    );
  }

  const adjustment = buildPauseBillingAdjustment({
    subscriptionId,
    price: body.price,
    currency: body.currency ?? 'USD',
    periodDays: resolvePeriodDays(body),
    pauseDays: body.pauseDays,
  });

  return success({
    adjustment,
    earlyResumeCredit: adjustment.creditAmount,
    scheduledResumeAt: new Date(Date.now() + body.pauseDays * 24 * 60 * 60 * 1000).toISOString(),
  });
}

/** POST /subscriptions/:id/pause/resume */
export function resumeSubscription(
  subscriptionId: string,
  body: ResumeRequestBody,
  requestId?: string
): PauseOutcome {
  try {
    const session = pauseStateStore.resume(subscriptionId, body?.early === true);
    const view = toView(session);
    return { ...view, status: 200 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to resume subscription';
    return error('NOT_FOUND', message, 404, requestId);
  }
}

/** GET /subscriptions/:id/pause */
export function getPauseState(
  subscriptionId: string,
  requestId?: string
): PauseOutcome<PauseStateView> {
  const history = pauseStateStore.list(subscriptionId);
  if (history.length === 0) {
    return error(
      'SUBSCRIPTION_NOT_FOUND',
      `No pause history for "${subscriptionId}"`,
      404,
      requestId
    );
  }
  const active = history.find((s) => s.status === 'paused');
  return success({ active: active ?? null, history });
}
