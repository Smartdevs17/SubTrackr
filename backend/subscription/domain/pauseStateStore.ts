/**
 * In-memory pause state store (Issue #1116).
 *
 * Tracks which subscriptions are paused, when they should auto-resume and the
 * credit ledger entry produced by the billing adjustment. Mirrors the
 * in-memory pattern used by `publicDataStore`.
 */

import {
  type PauseBillingAdjustment,
  type PauseReason,
  daysFromNow,
  validatePauseRequest,
} from './pauseBilling';

export type PauseStatus = 'paused' | 'resumed';

export interface PauseSession {
  id: string;
  subscriptionId: string;
  status: PauseStatus;
  reason: PauseReason;
  note?: string;
  pauseDays: number;
  pausedAt: string;
  scheduledResumeAt: string;
  resumedAt?: string;
  adjustment: PauseBillingAdjustment;
  /** Credit still available on the ledger entry. */
  creditRemaining: number;
}

export interface PauseStoreSeed {
  subscriptionId: string;
  price: number;
  currency: string;
  periodDays: number;
  pauseDays: number;
  reason: PauseReason;
  note?: string;
}

export class PauseStateStore {
  private sessions = new Map<string, PauseSession>();
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `pause_${this.seq}`;
  }

  reset(): void {
    this.sessions.clear();
    this.seq = 0;
  }

  list(subscriptionId?: string): PauseSession[] {
    const all = Array.from(this.sessions.values());
    return subscriptionId ? all.filter((s) => s.subscriptionId === subscriptionId) : all;
  }

  getActive(subscriptionId: string): PauseSession | undefined {
    return this.list(subscriptionId).find((s) => s.status === 'paused');
  }

  pausesThisYear(subscriptionId: string, now: Date = new Date()): number {
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
    return this.list(subscriptionId).filter(
      (s) => s.status === 'resumed' && new Date(s.pausedAt).getTime() >= yearStart
    ).length;
  }

  /**
   * Pause a subscription. Throws an Error with a human readable reason when
   * the request violates the configured limits.
   */
  pause(seed: PauseStoreSeed, now: Date = new Date()): PauseSession {
    const validation = validatePauseRequest(
      seed.pauseDays,
      Boolean(this.getActive(seed.subscriptionId)),
      this.pausesThisYear(seed.subscriptionId, now)
    );
    if (!validation.valid) {
      throw new Error(validation.reason ?? 'Invalid pause request.');
    }

    const adjustment = buildAdjustment(seed);
    const session: PauseSession = {
      id: this.nextId(),
      subscriptionId: seed.subscriptionId,
      status: 'paused',
      reason: seed.reason,
      note: seed.note,
      pauseDays: seed.pauseDays,
      pausedAt: now.toISOString(),
      scheduledResumeAt: daysFromNow(seed.pauseDays, now),
      adjustment,
      creditRemaining: adjustment.creditRemaining,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Resume an active pause. When `early` is true the unconsumed part of the
   * credit is returned to the customer ledger.
   */
  resume(subscriptionId: string, early: boolean, now: Date = new Date()): PauseSession {
    const active = this.getActive(subscriptionId);
    if (!active) {
      throw new Error('Subscription is not paused.');
    }

    const daysElapsed = Math.min(
      active.pauseDays,
      Math.max(
        0,
        Math.floor((now.getTime() - new Date(active.pausedAt).getTime()) / (24 * 60 * 60 * 1000))
      )
    );
    const fractionLeft = early ? (active.pauseDays - daysElapsed) / active.pauseDays : 0;
    const creditRemaining = round2(active.adjustment.creditAmount * fractionLeft);

    const resumed: PauseSession = {
      ...active,
      status: 'resumed',
      resumedAt: now.toISOString(),
      creditRemaining,
    };
    this.sessions.set(resumed.id, resumed);
    return resumed;
  }

  /** Auto-resume every session whose scheduled resume date has passed. */
  autoResumeDue(now: Date = new Date()): PauseSession[] {
    const due = this.list().filter(
      (s) => s.status === 'paused' && new Date(s.scheduledResumeAt).getTime() <= now.getTime()
    );
    return due.map((s) => this.resume(s.subscriptionId, false, now));
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildAdjustment(seed: PauseStoreSeed): PauseBillingAdjustment {
  const creditAmount = round2(
    Math.min(seed.price, (seed.pauseDays / seed.periodDays) * seed.price)
  );
  return {
    subscriptionId: seed.subscriptionId,
    currency: seed.currency,
    pauseDays: seed.pauseDays,
    periodDays: seed.periodDays,
    creditAmount,
    earlyResumeCredit: creditAmount,
    creditRemaining: creditAmount,
    remainingBalance: round2(Math.max(0, seed.price - creditAmount)),
    creditExpiryDays: 90,
  };
}

export const pauseStateStore = new PauseStateStore();
