/**
 * interventionService.ts
 *
 * Automated churn intervention system.
 *
 * Responsibilities:
 *   1. Fetch churn predictions from the ML service via PredictionService
 *   2. Select the appropriate intervention strategy based on risk + factor
 *   3. Dispatch actions (discount offer, re-engagement email, support escalation, etc.)
 *   4. Log every intervention attempt with outcome for auditability
 *   5. Provide scheduling helpers for recurring automated runs
 */

import { PredictionService, UserChurnData, InterventionRecommendation } from './prediction';
import { AnalyticsError, AnalyticsErrorCode } from './errors';

// ── Intervention types ──────────────────────────────────────────────────────

export type InterventionType =
  | 'discount_offer'
  | 'urgent_discount_offer'
  | 'payment_recovery_email'
  | 'urgent_payment_recovery_email'
  | 're_engagement_email'
  | 'urgent_re_engagement_email'
  | 'priority_support_escalation'
  | 'urgent_priority_support_escalation'
  | 'technical_outreach'
  | 'urgent_technical_outreach'
  | 'retention_discount'
  | 'urgent_retention_discount'
  | 'no_action';

export type InterventionStatus = 'pending' | 'dispatched' | 'failed' | 'skipped';

export interface InterventionRecord {
  id: string;
  subscriber: string;
  churnProbability: number;
  riskLevel: 'High' | 'Medium' | 'Low';
  interventionType: InterventionType;
  recommendedAction: string;
  status: InterventionStatus;
  dispatchedAt?: string;
  failureReason?: string;
  metadata: Record<string, unknown>;
}

export interface RunInterventionsOptions {
  /** Subscribers to evaluate. */
  subscribers: Array<{ id: string; userData: UserChurnData }>;
  /** Minimum risk level that triggers an intervention. Default: 'High'. */
  riskThreshold?: 'High' | 'Medium';
  /** Whether to actually dispatch actions or just produce a dry-run report. */
  dryRun?: boolean;
  /** Dispatcher implementation to use (defaults to LogDispatcher). */
  dispatcher?: InterventionDispatcher;
}

export interface RunInterventionsResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  totalEvaluated: number;
  totalInterventions: number;
  dispatched: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  records: InterventionRecord[];
}

// ── Dispatcher interface ────────────────────────────────────────────────────

/**
 * Dispatchers are responsible for the side-effect of an intervention
 * (sending an email, applying a discount via billing API, etc.).
 * Swap implementations per environment without touching business logic.
 */
export interface InterventionDispatcher {
  dispatch(record: InterventionRecord): Promise<void>;
}

// ── Built-in dispatchers ────────────────────────────────────────────────────

/** Logs the intervention to stdout. Used in development / dry-run mode. */
export class LogDispatcher implements InterventionDispatcher {
  async dispatch(record: InterventionRecord): Promise<void> {
    console.log(
      `[InterventionService] ${record.interventionType} → subscriber=${record.subscriber}` +
        ` churn=${record.churnProbability.toFixed(3)} risk=${record.riskLevel}` +
        ` action="${record.recommendedAction}"`,
    );
  }
}

/**
 * Composite dispatcher – fans out to multiple implementations.
 * Errors from individual dispatchers are caught and logged so one failing
 * channel doesn't abort the others.
 */
export class CompositeDispatcher implements InterventionDispatcher {
  constructor(private readonly dispatchers: InterventionDispatcher[]) {}

  async dispatch(record: InterventionRecord): Promise<void> {
    await Promise.allSettled(
      this.dispatchers.map((d) =>
        d.dispatch(record).catch((err) =>
          console.error(`[CompositeDispatcher] ${d.constructor.name} failed:`, err),
        ),
      ),
    );
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

let _idCounter = 0;
function generateId(): string {
  return `itv-${Date.now()}-${(++_idCounter).toString(36)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── InterventionService ─────────────────────────────────────────────────────

export class InterventionService {
  private static _defaultDispatcher: InterventionDispatcher = new LogDispatcher();

  /**
   * Override the default dispatcher (e.g. in tests or at application startup).
   */
  static setDefaultDispatcher(dispatcher: InterventionDispatcher): void {
    InterventionService._defaultDispatcher = dispatcher;
  }

  /**
   * Main entry point.  Evaluates the provided subscribers against the ML service
   * and dispatches the appropriate intervention for each at-risk user.
   */
  static async runAutomatedInterventions(
    options: RunInterventionsOptions,
  ): Promise<RunInterventionsResult> {
    const {
      subscribers,
      riskThreshold = 'High',
      dryRun = false,
      dispatcher = InterventionService._defaultDispatcher,
    } = options;

    const runId = generateId();
    const startedAt = nowIso();
    const records: InterventionRecord[] = [];

    if (subscribers.length === 0) {
      return {
        runId,
        startedAt,
        completedAt: nowIso(),
        totalEvaluated: 0,
        totalInterventions: 0,
        dispatched: 0,
        failed: 0,
        skipped: 0,
        dryRun,
        records,
      };
    }

    // Build data map for the ML service
    const userDataMap = new Map<string, UserChurnData>(
      subscribers.map((s) => [s.id, s.userData]),
    );

    let mlResult;
    try {
      mlResult = await PredictionService.evaluateInterventions(
        subscribers.map((s) => s.id),
        userDataMap,
        { riskThreshold },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AnalyticsError(
        AnalyticsErrorCode.PREDICTION_FAILED,
        `Automated intervention run ${runId} failed during ML evaluation: ${reason}`,
        { runId, reason },
      );
    }

    // Process each recommended intervention
    for (const recommendation of mlResult.interventions) {
      const record = InterventionService._buildRecord(recommendation);

      if (dryRun) {
        record.status = 'skipped';
        records.push(record);
        continue;
      }

      try {
        await dispatcher.dispatch(record);
        record.status = 'dispatched';
        record.dispatchedAt = nowIso();
      } catch (err) {
        record.status = 'failed';
        record.failureReason = err instanceof Error ? err.message : String(err);
        console.error(
          `[InterventionService] Dispatch failed for ${record.subscriber}:`,
          err,
        );
      }

      records.push(record);
    }

    const dispatched = records.filter((r) => r.status === 'dispatched').length;
    const failed = records.filter((r) => r.status === 'failed').length;
    const skipped = records.filter((r) => r.status === 'skipped').length;

    return {
      runId,
      startedAt,
      completedAt: nowIso(),
      totalEvaluated: mlResult.evaluated,
      totalInterventions: records.length,
      dispatched,
      failed,
      skipped,
      dryRun,
      records,
    };
  }

  /**
   * Convenience overload that accepts raw subscriber + userData arrays (matches
   * the legacy call-site shape used by the old InterventionService).
   */
  static async runAutomatedInterventionsLegacy(
    subscriptions: Array<{
      id: string;
      chargeCount?: number;
      price?: number;
      category?: string;
      billingCycle?: string;
      currency?: string;
      name?: string;
    }>,
  ): Promise<RunInterventionsResult> {
    const subscribers = subscriptions.map((s) => ({
      id: s.id,
      userData: {
        recentPaymentFailures: s.chargeCount ? s.chargeCount % 3 : 0,
        baselineLoginsPerMonth: 20,
        recentLogins: 5,
        openSupportTickets: 0,
        appCrashes: 0,
        priceSensitivityIndex: 0.7,
      },
    }));

    return InterventionService.runAutomatedInterventions({ subscribers });
  }

  // ── Scheduling helpers ────────────────────────────────────────────────────

  /**
   * Returns a simple schedule runner that invokes ``runAutomatedInterventions``
   * at a fixed interval.  Call ``.stop()`` to cancel the timer.
   *
   * Example (run every 6 hours):
   * ```ts
   * const schedule = InterventionService.schedule(getSubscribers, 6 * 60 * 60_000);
   * // later:
   * schedule.stop();
   * ```
   */
  static schedule(
    subscribersFn: () => Promise<Array<{ id: string; userData: UserChurnData }>>,
    intervalMs: number,
    options?: Omit<RunInterventionsOptions, 'subscribers'>,
  ): { stop: () => void } {
    let running = true;

    const tick = async () => {
      if (!running) return;
      try {
        const subscribers = await subscribersFn();
        await InterventionService.runAutomatedInterventions({ subscribers, ...options });
      } catch (err) {
        console.error('[InterventionService] Scheduled run failed:', err);
      }
    };

    // First tick after one interval
    const handle = setInterval(tick, intervalMs);

    return {
      stop: () => {
        running = false;
        clearInterval(handle);
      },
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private static _buildRecord(r: InterventionRecommendation): InterventionRecord {
    return {
      id: generateId(),
      subscriber: r.subscriber,
      churnProbability: r.churnProbability,
      riskLevel: r.riskLevel,
      interventionType: (r.interventionType as InterventionType) ?? 'retention_discount',
      recommendedAction: r.recommendedAction,
      status: 'pending',
      metadata: {
        riskFactors: r.riskFactors,
        featureDriftDetected: r.featureDriftDetected,
      },
    };
  }
}

// ── Re-export legacy class shape for backward compat ─────────────────────────

/**
 * @deprecated Use ``InterventionService.runAutomatedInterventions`` directly.
 */
export const legacyRunAutomatedInterventions =
  InterventionService.runAutomatedInterventionsLegacy.bind(InterventionService);
