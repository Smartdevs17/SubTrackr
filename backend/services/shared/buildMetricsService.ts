/**
 * Build Metrics Exporter — SubTrackr
 *
 * Issue #1285: Build metrics exporter for Prometheus
 *
 * Records CI/CD build pipeline telemetry and renders it in the Prometheus
 * text exposition format (`text/plain; version=0.0.4`) so build health —
 * duration, success rate, artifact size regressions — is scrapeable and
 * alertable next to the runtime metrics the backend already exposes.
 *
 * Features:
 *  - Per-pipeline run counters split by outcome (success / failure / cancelled)
 *  - Duration percentiles (p50 / p95 / p99) over a bounded sample window
 *  - Per-stage durations so slow pipeline steps stay attributable
 *  - Artifact size tracking with budget compliance + breach counters
 *  - In-flight tracking (beginBuild / endBuild) for live gauges
 *  - Bounded run history for JSON dashboards
 *  - Defensive ingestion of untrusted CI reports (ingestBuildReport)
 *  - Prometheus text exposition + JSON summary
 *  - Build completion sinks for alerting integrations
 */

import { logger } from './logging';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Completed runs retained in memory for the JSON history/dashboard. */
const DEFAULT_MAX_HISTORY = 200;

/** Duration samples retained per pipeline for percentile calculation. */
const DEFAULT_MAX_SAMPLES = 100;

/**
 * Distinct failure reasons retained per pipeline. Reason strings come from CI
 * logs, so they are bucketed to keep Prometheus label cardinality bounded.
 */
const DEFAULT_MAX_FAILURE_REASONS = 20;

const OVERFLOW_REASON = 'other';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BuildStatus = 'success' | 'failure' | 'cancelled';

export const BUILD_STATUSES: readonly BuildStatus[] = ['success', 'failure', 'cancelled'];

export interface BuildStageRecord {
  stage: string;
  durationMs: number;
  status: BuildStatus;
}

export interface BuildArtifactRecord {
  name: string;
  sizeBytes: number;
}

export interface BuildRunInput {
  pipeline: string;
  status: BuildStatus;
  durationMs: number;
  runId?: string;
  commitSha?: string;
  branch?: string;
  stages?: BuildStageRecord[];
  artifacts?: BuildArtifactRecord[];
  /** Free-form reason, only meaningful when status is `failure`. */
  failureReason?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface BuildRunRecord extends BuildRunInput {
  pipeline: string;
  status: BuildStatus;
  durationMs: number;
  runId: string;
  stages: BuildStageRecord[];
  artifacts: BuildArtifactRecord[];
  completedAt: number;
  /** True when at least one artifact exceeded the configured budget. */
  budgetBreached: boolean;
  /** Epoch ms at which the service accepted the run. */
  recordedAt: number;
}

export interface BuildStartMeta {
  runId?: string;
  commitSha?: string;
  branch?: string;
}

/** Opaque token returned by `beginBuild` and consumed by `endBuild`. */
export interface BuildHandle {
  token: string;
  pipeline: string;
  runId: string;
  commitSha?: string;
  branch?: string;
  startedAt: number;
}

export interface EndBuildResult {
  status: BuildStatus;
  /** Overrides the wall-clock duration measured from `beginBuild`. */
  durationMs?: number;
  stages?: BuildStageRecord[];
  artifacts?: BuildArtifactRecord[];
  failureReason?: string;
}

export interface StageBuildStats {
  runs: number;
  failures: number;
  totalDurationMs: number;
  lastDurationMs: number;
  avgDurationMs: number;
}

export interface ArtifactBuildStats {
  lastSizeBytes: number;
  maxSizeBytes: number;
  breaches: number;
}

export interface PipelineBuildStats {
  pipeline: string;
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  cancelledRuns: number;
  successRatePct: number;
  inProgress: number;
  lastStatus: BuildStatus | null;
  lastDurationMs: number;
  maxDurationMs: number;
  lastCompletedAt: number;
  lastSuccessAt: number;
  /** `NaN` until at least one run has been recorded for the pipeline. */
  durationP50Ms: number;
  durationP95Ms: number;
  durationP99Ms: number;
  lastCommitSha: string;
  lastBranch: string;
  failureReasons: Record<string, number>;
  stages: Record<string, StageBuildStats>;
  artifacts: Record<string, ArtifactBuildStats>;
  budgetBreaches: number;
}

export type RejectionReason = 'validation' | 'malformedStage' | 'malformedArtifact';

export interface BuildMetrics {
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  cancelledRuns: number;
  successRatePct: number;
  inProgress: number;
  trackedPipelines: number;
  lastCompletedAt: number;
  lastSuccessAt: number;
  artifactBudgetBytes: number | null;
  budgetBreaches: number;
  rejectedRecords: Record<RejectionReason, number>;
  pipelines: Record<string, PipelineBuildStats>;
}

export interface BuildIngestResult {
  accepted: BuildRunRecord[];
  rejected: Array<{ index: number; reason: string }>;
}

export interface BuildMetricsServiceOptions {
  /** Per-artifact size ceiling in bytes; `null` disables budget checks. */
  artifactBudgetBytes?: number | null;
  maxHistory?: number;
  maxSamples?: number;
  maxFailureReasons?: number;
  /** Clock injection point for deterministic tests. */
  now?: () => number;
}

/** Thrown when a caller supplies a run that cannot be represented safely. */
export class BuildMetricsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildMetricsValidationError';
  }
}

// ---------------------------------------------------------------------------
// Prometheus formatting helpers
// ---------------------------------------------------------------------------

/**
 * Escape a label value per the Prometheus text format: backslash, double
 * quote and line feed are the only characters that require escaping.
 */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

/**
 * Render a sample value. `NaN`, `+Inf` and `-Inf` are legal Prometheus sample
 * values and are preferred over magic sentinels because dashboards can tell
 * "no data" apart from a real zero.
 */
export function sampleValue(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return '+Inf';
  if (value === Number.NEGATIVE_INFINITY) return '-Inf';
  return String(value);
}

/** Render a millisecond/duration sample as a rounded integer. */
export function sampleMs(valueMs: number): string {
  if (!Number.isFinite(valueMs)) return sampleValue(valueMs);
  return String(Math.round(valueMs));
}

/** Nearest-rank percentile over an ascending-sorted sample array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const index = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[index];
}

function isBuildStatus(value: unknown): value is BuildStatus {
  return typeof value === 'string' && (BUILD_STATUSES as readonly string[]).includes(value);
}

/**
 * CI-specific outcomes folded onto the three exported statuses so a raw
 * provider payload cannot widen the label set. GitHub Actions `conclusion`
 * values map as: anything that ran but did not succeed is a `failure`, and
 * `skipped` work is `cancelled` because it never produced a build.
 */
const CI_STATUS_ALIASES: Record<string, BuildStatus> = {
  success: 'success',
  neutral: 'success',
  failure: 'failure',
  timed_out: 'failure',
  action_required: 'failure',
  startup_failure: 'failure',
  stale: 'failure',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  skipped: 'cancelled',
};

/** Resolve a status from a canonical value or a CI-specific alias. */
function resolveBuildStatus(value: unknown): BuildStatus | null {
  if (isBuildStatus(value)) return value;
  if (typeof value !== 'string') return null;
  return CI_STATUS_ALIASES[value.trim().toLowerCase()] ?? null;
}

/** Coerce a numeric field that may arrive as a string from JSON / CI output. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/**
 * Validate and normalise an untrusted build run payload — for example the
 * JSON a CI step writes to disk and hands to the exporter. Nested stage and
 * artifact entries are passed through unfiltered so `recordBuildRun` can count
 * the malformed ones. Throws `BuildMetricsValidationError` on bad input.
 */
export function parseBuildRunInput(raw: unknown): BuildRunInput {
  const obj = asRecord(raw);
  if (!obj) throw new BuildMetricsValidationError('build run must be an object');

  const pipeline = optionalString(obj['pipeline']);
  if (!pipeline) throw new BuildMetricsValidationError('build run requires a non-empty "pipeline"');

  const status = resolveBuildStatus(obj['status'] ?? obj['conclusion'] ?? obj['outcome']);
  if (!status) {
    throw new BuildMetricsValidationError(
      `build run status must be one of ${BUILD_STATUSES.join(', ')}, either directly or ` +
        'via a CI alias ("conclusion"/"outcome", e.g. "timed_out" → failure)',
    );
  }

  const durationMs = toFiniteNumber(obj['durationMs'] ?? obj['duration_ms']);
  if (durationMs === null) {
    throw new BuildMetricsValidationError('build run requires a finite "durationMs"');
  }
  if (durationMs < 0) {
    throw new BuildMetricsValidationError('build run "durationMs" must not be negative');
  }

  const input: BuildRunInput = { pipeline, status, durationMs };
  const runId = optionalString(obj['runId'] ?? obj['run_id'] ?? obj['id']);
  const commitSha = optionalString(obj['commitSha'] ?? obj['commit_sha'] ?? obj['sha']);
  const branch = optionalString(obj['branch'] ?? obj['ref']);
  const failureReason = optionalString(obj['failureReason'] ?? obj['failure_reason']);
  const startedAt = toFiniteNumber(obj['startedAt'] ?? obj['started_at']);
  const completedAt = toFiniteNumber(obj['completedAt'] ?? obj['completed_at']);

  if (Array.isArray(obj['stages'])) input.stages = obj['stages'] as BuildStageRecord[];
  if (Array.isArray(obj['artifacts'])) input.artifacts = obj['artifacts'] as BuildArtifactRecord[];
  if (runId) input.runId = runId;
  if (commitSha) input.commitSha = commitSha;
  if (branch) input.branch = branch;
  if (failureReason) input.failureReason = failureReason;
  if (startedAt !== null) input.startedAt = startedAt;
  if (completedAt !== null) input.completedAt = completedAt;

  return input;
}

// ---------------------------------------------------------------------------
// Internal state shapes
// ---------------------------------------------------------------------------

interface InFlightBuild {
  token: string;
  pipeline: string;
  runId: string;
  startedAt: number;
  commitSha?: string;
  branch?: string;
}

interface PipelineState {
  pipeline: string;
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  cancelledRuns: number;
  inProgress: number;
  lastStatus: BuildStatus | null;
  lastDurationMs: number;
  maxDurationMs: number;
  lastCompletedAt: number;
  lastSuccessAt: number;
  lastCommitSha: string;
  lastBranch: string;
  samples: number[];
  failureReasons: Record<string, number>;
  stages: Record<string, StageBuildStats>;
  artifacts: Record<string, ArtifactBuildStats>;
  budgetBreaches: number;
}

interface MetricFamily {
  name: string;
  help: string;
  type: 'counter' | 'gauge';
  samples: string[];
}

// ---------------------------------------------------------------------------
// BuildMetricsService
// ---------------------------------------------------------------------------

export class BuildMetricsService {
  private readonly pipelines = new Map<string, PipelineState>();
  private readonly inFlight = new Map<string, InFlightBuild>();
  private readonly history: BuildRunRecord[] = [];
  private readonly rejected: Record<RejectionReason, number> = {
    validation: 0,
    malformedStage: 0,
    malformedArtifact: 0,
  };
  private readonly sinks: Array<(record: BuildRunRecord) => void> = [];

  private artifactBudgetBytes: number | null;
  private readonly maxHistory: number;
  private readonly maxSamples: number;
  private readonly maxFailureReasons: number;
  private readonly now: () => number;
  private handleSeq = 0;

  constructor(options: BuildMetricsServiceOptions = {}) {
    this.artifactBudgetBytes = BuildMetricsService.normaliseBudget(options.artifactBudgetBytes);
    this.maxHistory = Math.max(1, options.maxHistory ?? DEFAULT_MAX_HISTORY);
    this.maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
    this.maxFailureReasons = Math.max(1, options.maxFailureReasons ?? DEFAULT_MAX_FAILURE_REASONS);
    this.now = options.now ?? (() => Date.now());
  }

  private static normaliseBudget(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  }

  // ── Configuration ────────────────────────────────────────────────────────

  /** Set the per-artifact budget in bytes; `null`/non-positive disables it. */
  setArtifactBudget(bytes: number | null): void {
    this.artifactBudgetBytes = BuildMetricsService.normaliseBudget(bytes);
  }

  getArtifactBudget(): number | null {
    return this.artifactBudgetBytes;
  }

  /** Register a sink invoked after every accepted run. Returns an unsubscribe. */
  onBuildComplete(handler: (record: BuildRunRecord) => void): () => void {
    this.sinks.push(handler);
    return () => {
      const index = this.sinks.indexOf(handler);
      if (index >= 0) this.sinks.splice(index, 1);
    };
  }

  // ── Recording ────────────────────────────────────────────────────────────

  /**
   * Mark a build as started. The returned handle carries the start timestamp so
   * `endBuild` can derive the duration without a caller-side timer.
   */
  beginBuild(pipeline: string, meta: BuildStartMeta = {}): BuildHandle {
    const name = this.assertPipeline(pipeline);
    this.handleSeq += 1;
    const startedAt = this.now();
    const handle: InFlightBuild = {
      token: `${name}:${this.handleSeq}`,
      pipeline: name,
      runId: meta.runId ?? `local-${this.handleSeq}`,
      startedAt,
    };
    if (meta.commitSha) handle.commitSha = meta.commitSha;
    if (meta.branch) handle.branch = meta.branch;

    this.inFlight.set(handle.token, handle);
    this.getOrCreatePipeline(name).inProgress += 1;
    return { ...handle };
  }

  /**
   * Close a build started with `beginBuild` and record it. Throws when the
   * handle is unknown (never issued, or already ended).
   */
  endBuild(handle: BuildHandle, result: EndBuildResult): BuildRunRecord {
    const pending = this.inFlight.get(handle.token);
    if (!pending) {
      this.rejected.validation += 1;
      throw new BuildMetricsValidationError(
        `unknown build handle "${handle.token}" — it was never started or is already ended`,
      );
    }
    this.inFlight.delete(handle.token);
    const state = this.getOrCreatePipeline(pending.pipeline);
    state.inProgress = Math.max(0, state.inProgress - 1);

    const input: BuildRunInput = {
      pipeline: pending.pipeline,
      status: result.status,
      durationMs: result.durationMs ?? Math.max(0, this.now() - pending.startedAt),
      startedAt: pending.startedAt,
      runId: pending.runId,
    };
    if (pending.commitSha) input.commitSha = pending.commitSha;
    if (pending.branch) input.branch = pending.branch;
    if (result.stages) input.stages = result.stages;
    if (result.artifacts) input.artifacts = result.artifacts;
    if (result.failureReason) input.failureReason = result.failureReason;

    return this.recordBuildRun(input);
  }

  /**
   * Record a completed build run. Invalid input throws
   * `BuildMetricsValidationError` and increments the rejection counter; use
   * `ingestBuildReport` when the payload is untrusted.
   */
  recordBuildRun(input: BuildRunInput): BuildRunRecord {
    const pipeline = this.assertPipeline(input?.pipeline);
    if (!isBuildStatus(input?.status)) {
      this.countRejection('validation');
      throw new BuildMetricsValidationError(
        `build run status must be one of ${BUILD_STATUSES.join(', ')}`,
      );
    }
    if (!Number.isFinite(input?.durationMs) || (input.durationMs as number) < 0) {
      this.countRejection('validation');
      throw new BuildMetricsValidationError(
        'build run "durationMs" must be a finite, non-negative number',
      );
    }

    const recordedAt = this.now();
    const completedAt = Number.isFinite(input.completedAt)
      ? (input.completedAt as number)
      : recordedAt;
    const stages = this.normaliseStages(input.stages, input.status);
    const artifacts = this.normaliseArtifacts(input.artifacts);

    const record: BuildRunRecord = {
      pipeline,
      status: input.status,
      durationMs: input.durationMs as number,
      runId: input.runId ?? `run-${recordedAt}-${this.handleSeq}`,
      stages,
      artifacts,
      completedAt,
      budgetBreached: false,
      recordedAt,
    };
    if (input.commitSha) record.commitSha = input.commitSha;
    if (input.branch) record.branch = input.branch;
    if (input.startedAt !== undefined) record.startedAt = input.startedAt;
    if (input.failureReason) record.failureReason = input.failureReason;

    const state = this.getOrCreatePipeline(pipeline);
    state.totalRuns += 1;
    state.lastStatus = input.status as BuildStatus;
    state.lastDurationMs = input.durationMs as number;
    state.maxDurationMs = Math.max(state.maxDurationMs, input.durationMs as number);
    state.lastCompletedAt = completedAt;
    if (input.commitSha) state.lastCommitSha = input.commitSha;
    if (input.branch) state.lastBranch = input.branch;
    if (record.status === 'success') {
      state.successRuns += 1;
      state.lastSuccessAt = completedAt;
    } else if (record.status === 'failure') {
      state.failureRuns += 1;
    } else {
      state.cancelledRuns += 1;
    }

    this.pushSample(state, record.durationMs);
    this.applyStages(state, stages);
    record.budgetBreached = this.applyArtifacts(state, artifacts);

    if (record.status === 'failure' && input.failureReason) {
      this.applyFailureReason(state, input.failureReason);
    }

    this.pushHistory(record);
    this.emit(record);
    return record;
  }

  /**
   * Ingest an untrusted CI report. Accepts a single run object, an array of
   * runs, or `{ runs: [...] }`. Never throws: malformed entries are reported
   * with their index so a partially broken report still yields metrics.
   */
  ingestBuildReport(report: unknown): BuildIngestResult {
    const accepted: BuildRunRecord[] = [];
    const rejected: Array<{ index: number; reason: string }> = [];

    this.extractRunEntries(report).forEach((entry, index) => {
      try {
        accepted.push(this.recordBuildRun(parseBuildRunInput(entry)));
      } catch (err) {
        this.countRejection('validation');
        rejected.push({
          index,
          reason: err instanceof Error ? err.message : 'invalid build run',
        });
      }
    });

    return { accepted, rejected };
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /** Most recent runs, newest first. */
  getHistory(limit = 20): BuildRunRecord[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : this.maxHistory;
    if (safeLimit === 0) return [];
    return this.history.slice(-safeLimit).reverse();
  }

  getInFlightCount(pipeline?: string): number {
    if (!pipeline) return this.inFlight.size;
    let count = 0;
    for (const build of this.inFlight.values()) {
      if (build.pipeline === pipeline) count += 1;
    }
    return count;
  }

  /** JSON summary for dashboards and the `/build/metrics` endpoint. */
  getMetrics(): BuildMetrics {
    let totalRuns = 0;
    let successRuns = 0;
    let failureRuns = 0;
    let cancelledRuns = 0;
    let budgetBreaches = 0;
    let lastCompletedAt = 0;
    let lastSuccessAt = 0;

    const pipelines: Record<string, PipelineBuildStats> = {};
    for (const state of this.pipelines.values()) {
      totalRuns += state.totalRuns;
      successRuns += state.successRuns;
      failureRuns += state.failureRuns;
      cancelledRuns += state.cancelledRuns;
      budgetBreaches += state.budgetBreaches;
      lastCompletedAt = Math.max(lastCompletedAt, state.lastCompletedAt);
      lastSuccessAt = Math.max(lastSuccessAt, state.lastSuccessAt);
      pipelines[state.pipeline] = this.snapshotPipeline(state);
    }

    return {
      totalRuns,
      successRuns,
      failureRuns,
      cancelledRuns,
      successRatePct: BuildMetricsService.rate(successRuns, totalRuns),
      inProgress: this.inFlight.size,
      trackedPipelines: this.pipelines.size,
      lastCompletedAt,
      lastSuccessAt,
      artifactBudgetBytes: this.artifactBudgetBytes,
      budgetBreaches,
      rejectedRecords: { ...this.rejected },
      pipelines,
    };
  }

  getPipelineStats(pipeline: string): PipelineBuildStats | null {
    const state = this.pipelines.get(pipeline);
    return state ? this.snapshotPipeline(state) : null;
  }

  // ── Prometheus export ────────────────────────────────────────────────────

  /**
   * Render the Prometheus text exposition format. Exposed metric families:
   *
   *   subtrackr_build_runs_total                                 (counter)
   *   subtrackr_build_success_runs_total                         (counter)
   *   subtrackr_build_failure_runs_total                         (counter)
   *   subtrackr_build_cancelled_runs_total                       (counter)
   *   subtrackr_build_pipelines                                  (gauge)
   *   subtrackr_build_runs_rejected_total{reason}                (counter)
   *   subtrackr_build_artifact_budget_bytes                      (gauge)
   *   subtrackr_build_duration_ms{pipeline}                      (gauge)
   *   subtrackr_build_duration_p50_ms{pipeline}                 (gauge)
   *   subtrackr_build_duration_p95_ms{pipeline}                 (gauge)
   *   subtrackr_build_duration_p99_ms{pipeline}                 (gauge)
   *   subtrackr_build_in_progress{pipeline}                     (gauge)
   *   subtrackr_build_last_success_timestamp_seconds{pipeline}  (gauge)
   *   subtrackr_build_info{pipeline,commit,branch}              (gauge)
   *   subtrackr_build_stage_duration_ms{pipeline,stage}         (gauge)
   *   subtrackr_build_stage_failures_total{pipeline,stage}      (counter)
   *   subtrackr_build_artifact_size_bytes{pipeline,artifact}    (gauge)
   *   subtrackr_build_artifact_budget_ratio{pipeline,artifact}  (gauge)
   *   subtrackr_build_budget_breaches_total{pipeline,artifact}  (counter)
   *   subtrackr_build_failures_total{pipeline,reason}           (counter)
   */
  prometheusMetrics(namespace = 'subtrackr_build'): string {
    const families: MetricFamily[] = [];
    const emit = (
      name: string,
      help: string,
      type: 'counter' | 'gauge',
      sample: string,
    ): void => {
      let family = families.find((entry) => entry.name === name);
      if (!family) {
        family = { name, help, type, samples: [] };
        families.push(family);
      }
      family.samples.push(sample);
    };

    const metrics = this.getMetrics();

    const scalar = (
      name: string,
      help: string,
      type: 'counter' | 'gauge',
      value: number,
    ): void => emit(name, help, type, `${name} ${value}`);

    scalar(`${namespace}_runs_total`, 'Total build runs recorded', 'counter', metrics.totalRuns);
    scalar(
      `${namespace}_success_runs_total`,
      'Total successful build runs',
      'counter',
      metrics.successRuns,
    );
    scalar(
      `${namespace}_failure_runs_total`,
      'Total failed build runs',
      'counter',
      metrics.failureRuns,
    );
    scalar(
      `${namespace}_cancelled_runs_total`,
      'Total cancelled build runs',
      'counter',
      metrics.cancelledRuns,
    );
    scalar(
      `${namespace}_pipelines`,
      'Number of pipelines with recorded runs',
      'gauge',
      metrics.trackedPipelines,
    );
    scalar(
      `${namespace}_artifact_budget_bytes`,
      'Per-artifact size budget in bytes (0 when disabled)',
      'gauge',
      this.artifactBudgetBytes ?? 0,
    );

    for (const reason of Object.keys(this.rejected) as RejectionReason[]) {
      emit(
        `${namespace}_runs_rejected_total`,
        'Build run records rejected by validation',
        'counter',
        `${namespace}_runs_rejected_total{reason="${reason}"} ${this.rejected[reason]}`,
      );
    }

    for (const state of this.pipelines.values()) {
      const pipeline = escapeLabelValue(state.pipeline);
      const statusCount = (status: BuildStatus): number => {
        if (status === 'success') return state.successRuns;
        if (status === 'failure') return state.failureRuns;
        return state.cancelledRuns;
      };

      for (const status of BUILD_STATUSES) {
        emit(
          `${namespace}_runs_total`,
          'Build runs by pipeline and outcome',
          'counter',
          `${namespace}_runs_total{pipeline="${pipeline}",status="${status}"} ${statusCount(status)}`,
        );
      }

      emit(
        `${namespace}_duration_ms`,
        'Duration of the most recent build run',
        'gauge',
        `${namespace}_duration_ms{pipeline="${pipeline}"} ${sampleMs(state.lastDurationMs)}`,
      );

      const sorted = [...state.samples].sort((a, b) => a - b);
      for (const p of [50, 95, 99] as const) {
        emit(
          `${namespace}_duration_p${p}_ms`,
          `Build duration p${p} over the last ${this.maxSamples} runs`,
          'gauge',
          `${namespace}_duration_p${p}_ms{pipeline="${pipeline}"} ${sampleMs(percentile(sorted, p))}`,
        );
      }

      emit(
        `${namespace}_in_progress`,
        'Builds currently running',
        'gauge',
        `${namespace}_in_progress{pipeline="${pipeline}"} ${state.inProgress}`,
      );

      emit(
        `${namespace}_last_success_timestamp_seconds`,
        'Unix time of the last successful run',
        'gauge',
        `${namespace}_last_success_timestamp_seconds{pipeline="${pipeline}"} ${sampleMs(state.lastSuccessAt / 1000)}`,
      );

      emit(
        `${namespace}_info`,
        'Static build metadata, always 1',
        'gauge',
        `${namespace}_info{pipeline="${pipeline}",commit="${escapeLabelValue(state.lastCommitSha)}",branch="${escapeLabelValue(state.lastBranch)}"} 1`,
      );

      for (const [stage, stats] of Object.entries(state.stages).sort(([a], [b]) => a.localeCompare(b))) {
        const labels = `pipeline="${pipeline}",stage="${escapeLabelValue(stage)}"`;
        emit(
          `${namespace}_stage_duration_ms`,
          'Duration of the most recent run of a build stage',
          'gauge',
          `${namespace}_stage_duration_ms{${labels}} ${sampleMs(stats.lastDurationMs)}`,
        );
        emit(
          `${namespace}_stage_failures_total`,
          'Failed runs of a build stage',
          'counter',
          `${namespace}_stage_failures_total{${labels}} ${stats.failures}`,
        );
      }

      for (const [artifact, stats] of Object.entries(state.artifacts).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const labels = `pipeline="${pipeline}",artifact="${escapeLabelValue(artifact)}"`;
        emit(
          `${namespace}_artifact_size_bytes`,
          'Size of the most recent build artifact',
          'gauge',
          `${namespace}_artifact_size_bytes{${labels}} ${sampleMs(stats.lastSizeBytes)}`,
        );
        emit(
          `${namespace}_budget_breaches_total`,
          'Build artifacts over the size budget',
          'counter',
          `${namespace}_budget_breaches_total{${labels}} ${stats.breaches}`,
        );
        if (this.artifactBudgetBytes !== null) {
          emit(
            `${namespace}_artifact_budget_ratio`,
            'Artifact size as a fraction of the budget (above 1 breaches)',
            'gauge',
            `${namespace}_artifact_budget_ratio{${labels}} ${sampleValue(stats.lastSizeBytes / (this.artifactBudgetBytes as number))}`,
          );
        }
      }

      for (const [reason, count] of Object.entries(state.failureReasons).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        emit(
          `${namespace}_failures_total`,
          'Failed build runs bucketed by reason',
          'counter',
          `${namespace}_failures_total{pipeline="${pipeline}",reason="${escapeLabelValue(reason)}"} ${count}`,
        );
      }
    }

    const lines: string[] = [];
    for (const family of families) {
      lines.push(`# HELP ${family.name} ${family.help}`);
      lines.push(`# TYPE ${family.name} ${family.type}`);
      lines.push(...family.samples);
    }
    return lines.join('\n') + '\n';
  }

  /** Drop all recorded runs, in-flight builds and rejection counters. */
  reset(): void {
    this.pipelines.clear();
    this.inFlight.clear();
    this.history.length = 0;
    this.rejected.validation = 0;
    this.rejected.malformedStage = 0;
    this.rejected.malformedArtifact = 0;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private static rate(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Number(((numerator / denominator) * 100).toFixed(2));
  }

  private countRejection(reason: RejectionReason): void {
    this.rejected[reason] += 1;
  }

  private assertPipeline(pipeline: unknown): string {
    const name = optionalString(pipeline)?.trim();
    if (!name) {
      this.countRejection('validation');
      throw new BuildMetricsValidationError('build run requires a non-empty "pipeline"');
    }
    return name;
  }

  private extractRunEntries(report: unknown): unknown[] {
    if (Array.isArray(report)) return report;
    const obj = asRecord(report);
    if (!obj) return [];
    const runs = obj['runs'] ?? obj['builds'] ?? obj['workflow_runs'];
    if (Array.isArray(runs)) return runs;
    if (obj['pipeline'] !== undefined) return [obj];
    return [];
  }

  private getOrCreatePipeline(pipeline: string): PipelineState {
    const existing = this.pipelines.get(pipeline);
    if (existing) return existing;
    const created: PipelineState = {
      pipeline,
      totalRuns: 0,
      successRuns: 0,
      failureRuns: 0,
      cancelledRuns: 0,
      inProgress: 0,
      lastStatus: null,
      lastDurationMs: 0,
      maxDurationMs: 0,
      lastCompletedAt: 0,
      lastSuccessAt: 0,
      lastCommitSha: '',
      lastBranch: '',
      samples: [],
      failureReasons: {},
      stages: {},
      artifacts: {},
      budgetBreaches: 0,
    };
    this.pipelines.set(pipeline, created);
    return created;
  }

  private pushSample(state: PipelineState, durationMs: number): void {
    state.samples.push(durationMs);
    if (state.samples.length > this.maxSamples) {
      state.samples.splice(0, state.samples.length - this.maxSamples);
    }
  }

  private normaliseStages(
    stages: BuildStageRecord[] | undefined,
    fallbackStatus: BuildStatus,
  ): BuildStageRecord[] {
    if (!Array.isArray(stages)) return [];
    const out: BuildStageRecord[] = [];
    for (const raw of stages) {
      const entry = asRecord(raw);
      const name = optionalString(entry?.['stage'] ?? entry?.['name'])?.trim();
      const durationMs = toFiniteNumber(entry?.['durationMs'] ?? entry?.['duration_ms']);
      const status = entry?.['status'];
      if (!name || durationMs === null || durationMs < 0) {
        this.countRejection('malformedStage');
        continue;
      }
      out.push({
        stage: name,
        durationMs,
        status: isBuildStatus(status) ? status : fallbackStatus,
      });
    }
    return out;
  }

  private normaliseArtifacts(artifacts: BuildArtifactRecord[] | undefined): BuildArtifactRecord[] {
    if (!Array.isArray(artifacts)) return [];
    const out: BuildArtifactRecord[] = [];
    for (const raw of artifacts) {
      const entry = asRecord(raw);
      const name = optionalString(entry?.['name'] ?? entry?.['file'])?.trim();
      const sizeBytes = toFiniteNumber(entry?.['sizeBytes'] ?? entry?.['size_bytes']);
      if (!name || sizeBytes === null || sizeBytes < 0) {
        this.countRejection('malformedArtifact');
        continue;
      }
      out.push({ name, sizeBytes });
    }
    return out;
  }

  private applyStages(state: PipelineState, stages: BuildStageRecord[]): void {
    for (const stage of stages) {
      const existing = state.stages[stage.stage];
      const stats: StageBuildStats = existing ?? {
        runs: 0,
        failures: 0,
        totalDurationMs: 0,
        lastDurationMs: 0,
        avgDurationMs: 0,
      };
      stats.runs += 1;
      stats.totalDurationMs += stage.durationMs;
      stats.lastDurationMs = stage.durationMs;
      stats.avgDurationMs = stats.totalDurationMs / stats.runs;
      if (stage.status === 'failure') stats.failures += 1;
      state.stages[stage.stage] = stats;
    }
  }

  /** Returns true when any artifact exceeded the configured budget. */
  private applyArtifacts(state: PipelineState, artifacts: BuildArtifactRecord[]): boolean {
    let breached = false;
    for (const artifact of artifacts) {
      const existing = state.artifacts[artifact.name];
      const stats: ArtifactBuildStats = existing ?? {
        lastSizeBytes: 0,
        maxSizeBytes: 0,
        breaches: 0,
      };
      stats.lastSizeBytes = artifact.sizeBytes;
      stats.maxSizeBytes = Math.max(stats.maxSizeBytes, artifact.sizeBytes);
      if (this.artifactBudgetBytes !== null && artifact.sizeBytes > this.artifactBudgetBytes) {
        stats.breaches += 1;
        state.budgetBreaches += 1;
        breached = true;
      }
      state.artifacts[artifact.name] = stats;
    }
    return breached;
  }

  private applyFailureReason(state: PipelineState, reason: string): void {
    if (state.failureReasons[reason] !== undefined) {
      state.failureReasons[reason] += 1;
      return;
    }
    if (Object.keys(state.failureReasons).length >= this.maxFailureReasons) {
      state.failureReasons[OVERFLOW_REASON] = (state.failureReasons[OVERFLOW_REASON] ?? 0) + 1;
      return;
    }
    state.failureReasons[reason] = 1;
  }

  private pushHistory(record: BuildRunRecord): void {
    this.history.push(record);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
  }

  private emit(record: BuildRunRecord): void {
    for (const sink of this.sinks) {
      try {
        sink(record);
      } catch (err) {
        logger.warn('[BuildMetrics] Build completion sink threw', {
          pipeline: record.pipeline,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private snapshotPipeline(state: PipelineState): PipelineBuildStats {
    const sorted = [...state.samples].sort((a, b) => a - b);
    return {
      pipeline: state.pipeline,
      totalRuns: state.totalRuns,
      successRuns: state.successRuns,
      failureRuns: state.failureRuns,
      cancelledRuns: state.cancelledRuns,
      successRatePct: BuildMetricsService.rate(state.successRuns, state.totalRuns),
      inProgress: state.inProgress,
      lastStatus: state.lastStatus,
      lastDurationMs: state.lastDurationMs,
      maxDurationMs: state.maxDurationMs,
      lastCompletedAt: state.lastCompletedAt,
      lastSuccessAt: state.lastSuccessAt,
      durationP50Ms: percentile(sorted, 50),
      durationP95Ms: percentile(sorted, 95),
      durationP99Ms: percentile(sorted, 99),
      lastCommitSha: state.lastCommitSha,
      lastBranch: state.lastBranch,
      failureReasons: { ...state.failureReasons },
      stages: Object.fromEntries(
        Object.entries(state.stages).map(([stage, stats]) => [stage, { ...stats }]),
      ),
      artifacts: Object.fromEntries(
        Object.entries(state.artifacts).map(([artifact, stats]) => [artifact, { ...stats }]),
      ),
      budgetBreaches: state.budgetBreaches,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const buildMetricsService = new BuildMetricsService({
  artifactBudgetBytes: Number(process.env['BUILD_ARTIFACT_BUDGET_BYTES'] ?? 0) || null,
});
