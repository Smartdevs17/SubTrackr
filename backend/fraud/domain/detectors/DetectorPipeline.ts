import { FraudContext, FraudTransaction } from '../rules/FraudRule';
import {
  aggregateScore,
  determineAction,
  DEFAULT_BLOCK_THRESHOLD,
  DEFAULT_FLAG_THRESHOLD,
  FraudAction,
} from '../aggregation';
import { DetectorObserver, DetectorOutcome, DetectorResult, FraudDetector } from './FraudDetector';

export interface PipelineOptions {
  flagThreshold?: number;
  blockThreshold?: number;
  /** Default per-detector timeout in ms. */
  defaultTimeoutMs?: number;
  observer?: DetectorObserver;
}

export interface DetectorScore {
  detectorId: string;
  category: string;
  rawScore: number;
  weightedScore: number;
  reasons: string[];
  triggered: boolean;
}

export interface DetectorFailure {
  detectorId: string;
  outcome: Exclude<DetectorOutcome, 'ok'>;
  message: string;
}

export interface PipelineResult {
  totalScore: number;
  action: FraudAction;
  reason: string;
  scores: DetectorScore[];
  /** Detectors that errored, timed out or returned an invalid result. */
  failures: DetectorFailure[];
  evaluationMs: number;
}

const DEFAULT_TIMEOUT_MS = 2000;

function isValidResult(r: unknown): r is DetectorResult {
  const x = r as DetectorResult;
  return (
    !!x &&
    typeof x.score === 'number' &&
    Number.isFinite(x.score) &&
    x.score >= 0 &&
    x.score <= 100 &&
    Array.isArray(x.reasons) &&
    typeof x.triggered === 'boolean'
  );
}

class TimeoutError extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs registered detectors concurrently, isolating failures and timeouts,
 * and aggregates their scores with the same math as the legacy Scorer.
 */
export class DetectorPipeline {
  private readonly detectors = new Map<string, FraudDetector>();
  private readonly opts: Required<Omit<PipelineOptions, 'observer'>> & { observer?: DetectorObserver };

  constructor(options: PipelineOptions = {}) {
    this.opts = {
      flagThreshold: options.flagThreshold ?? DEFAULT_FLAG_THRESHOLD,
      blockThreshold: options.blockThreshold ?? DEFAULT_BLOCK_THRESHOLD,
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      observer: options.observer,
    };
  }

  register(detector: FraudDetector): this {
    if (!detector.id) throw new Error('Detector must have an id');
    if (!(detector.weight > 0)) {
      throw new Error(`Detector "${detector.id}" must have a weight > 0`);
    }
    if (this.detectors.has(detector.id)) {
      throw new Error(`Detector "${detector.id}" is already registered`);
    }
    this.detectors.set(detector.id, detector);
    return this;
  }

  unregister(id: string): boolean {
    return this.detectors.delete(id);
  }

  list(): FraudDetector[] {
    return Array.from(this.detectors.values());
  }

  async evaluate(transaction: FraudTransaction, context: FraudContext): Promise<PipelineResult> {
    const start = Date.now();
    const active = this.list().filter((d) => d.enabled);

    if (active.length === 0) {
      return {
        totalScore: 0,
        action: 'approve',
        reason: 'Pass-through: no detectors enabled',
        scores: [],
        failures: [],
        evaluationMs: Date.now() - start,
      };
    }

    const settled = await Promise.all(active.map((d) => this.run(d, transaction, context)));

    const scores: DetectorScore[] = [];
    const failures: DetectorFailure[] = [];
    const weighted: { rawScore: number; weight: number }[] = [];

    for (const s of settled) {
      if (s.kind === 'failure') {
        failures.push(s.failure);
        continue;
      }
      scores.push({
        detectorId: s.detector.id,
        category: s.detector.category,
        rawScore: s.result.score,
        weightedScore: s.result.score * s.detector.weight,
        reasons: s.result.reasons,
        triggered: s.result.triggered,
      });
      weighted.push({ rawScore: s.result.score, weight: s.detector.weight });
    }

    const totalScore = aggregateScore(weighted, transaction.falsePositiveCount);
    const action = determineAction(totalScore, {
      flag: this.opts.flagThreshold,
      block: this.opts.blockThreshold,
    });

    const top = scores
      .filter((s) => s.triggered)
      .sort((a, b) => b.weightedScore - a.weightedScore)[0];

    return {
      totalScore,
      action,
      reason: top ? (top.reasons[0] ?? top.detectorId) : 'No fraud signals detected',
      scores,
      failures,
      evaluationMs: Date.now() - start,
    };
  }

  private async run(
    detector: FraudDetector,
    tx: FraudTransaction,
    ctx: FraudContext,
  ): Promise<
    | { kind: 'ok'; detector: FraudDetector; result: DetectorResult }
    | { kind: 'failure'; failure: DetectorFailure }
  > {
    const started = Date.now();
    const report = (outcome: DetectorOutcome, extra: { score?: number; error?: unknown } = {}) => {
      try {
        this.opts.observer?.onDetectorRun({
          detectorId: detector.id,
          transactionId: tx.id,
          outcome,
          durationMs: Date.now() - started,
          ...extra,
        });
      } catch {
        // Observers must never break scoring.
      }
    };

    try {
      const result = await withTimeout(
        Promise.resolve().then(() => detector.detect(tx, ctx)),
        detector.timeoutMs ?? this.opts.defaultTimeoutMs,
      );
      if (!isValidResult(result)) {
        report('invalid');
        return {
          kind: 'failure',
          failure: { detectorId: detector.id, outcome: 'invalid', message: 'invalid detector result' },
        };
      }
      report('ok', { score: result.score });
      return { kind: 'ok', detector, result };
    } catch (err) {
      const outcome = err instanceof TimeoutError ? 'timeout' : 'error';
      report(outcome, { error: err });
      return {
        kind: 'failure',
        failure: {
          detectorId: detector.id,
          outcome,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
