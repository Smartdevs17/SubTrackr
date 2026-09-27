/** Tests — Build Metrics Exporter (Issue #1285) */

import {
  BuildMetricsService,
  BuildMetricsValidationError,
  buildMetricsService,
  escapeLabelValue,
  parseBuildRunInput,
  percentile,
  sampleMs,
  sampleValue,
} from '../buildMetricsService';

type Service = BuildMetricsService;

const HOUR_MS = 3_600_000;

function makeService(overrides: ConstructorParameters<typeof BuildMetricsService>[0] = {}): Service {
  return new BuildMetricsService({ now: () => 1_700_000_000_000, ...overrides });
}

/** Minimal exposition-format validator: every sample line is `name{labels} value`. */
function parseExposition(text: string): Map<string, number> {
  const samples = new Map<string, number>();
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const lastSpace = line.lastIndexOf(' ');
    expect(lastSpace).toBeGreaterThan(0);
    samples.set(line.slice(0, lastSpace), Number(line.slice(lastSpace + 1)));
  }
  return samples;
}

describe('BuildMetricsService', () => {
  describe('recordBuildRun', () => {
    it('aggregates run counters, history and JSON summary', () => {
      const service = makeService();

      service.recordBuildRun({ pipeline: 'ci', status: 'success', durationMs: 1_000 });
      service.recordBuildRun({ pipeline: 'ci', status: 'failure', durationMs: 2_000, failureReason: 'lint' });
      service.recordBuildRun({ pipeline: 'release', status: 'cancelled', durationMs: 3_000 });

      const metrics = service.getMetrics();
      expect(metrics.totalRuns).toBe(3);
      expect(metrics.successRuns).toBe(1);
      expect(metrics.failureRuns).toBe(1);
      expect(metrics.cancelledRuns).toBe(1);
      expect(metrics.successRatePct).toBeCloseTo(33.33, 2);
      expect(metrics.trackedPipelines).toBe(2);
      expect(metrics.rejectedRecords.validation).toBe(0);
      expect(metrics.pipelines['ci']).toMatchObject({
        totalRuns: 2,
        successRuns: 1,
        failureRuns: 1,
        successRatePct: 50,
        lastStatus: 'failure',
        lastDurationMs: 2_000,
        maxDurationMs: 2_000,
        failureReasons: { lint: 1 },
      });
      expect(metrics.budgetBreaches).toBe(0);
      expect(metrics.inProgress).toBe(0);
    });

    it('tracks duration percentiles over the sample window', () => {
      const service = makeService({ maxSamples: 4 });
      for (const durationMs of [1_000, 2_000, 3_000, 4_000, 5_000]) {
        service.recordBuildRun({ pipeline: 'ci', status: 'success', durationMs });
      }

      const stats = service.getPipelineStats('ci');
      // Window keeps the 4 most recent samples: 2000, 3000, 4000, 5000.
      expect(stats?.durationP50Ms).toBe(3_000);
      expect(stats?.durationP95Ms).toBe(5_000);
      expect(stats?.durationP99Ms).toBe(5_000);
      expect(stats?.lastDurationMs).toBe(5_000);
    });

    it('returns NaN percentiles for a pipeline with no completed runs', () => {
      const service = makeService();
      const handle = service.beginBuild('ci');

      const stats = service.getPipelineStats('ci');
      expect(stats).not.toBeNull();
      expect(stats?.totalRuns).toBe(0);
      expect(Number.isNaN(stats?.durationP50Ms as number)).toBe(true);
      expect(handle.pipeline).toBe('ci');
    });

    it('records stage durations and stage failures', () => {
      const service = makeService();
      service.recordBuildRun({
        pipeline: 'ci',
        status: 'failure',
        durationMs: 5_000,
        stages: [
          { stage: 'lint', durationMs: 1_200, status: 'success' },
          { stage: 'test', durationMs: 3_800, status: 'failure' },
        ],
      });
      service.recordBuildRun({
        pipeline: 'ci',
        status: 'success',
        durationMs: 4_000,
        stages: [
          { stage: 'lint', durationMs: 1_000, status: 'success' },
          { stage: 'test', durationMs: 3_000, status: 'success' },
        ],
      });

      expect(service.getPipelineStats('ci')?.stages['lint']).toMatchObject({
        runs: 2,
        failures: 0,
        lastDurationMs: 1_000,
        totalDurationMs: 2_200,
        avgDurationMs: 1_100,
      });
      expect(service.getPipelineStats('ci')?.stages['test']).toMatchObject({
        runs: 2,
        failures: 1,
        lastDurationMs: 3_000,
      });
    });

    it('bounds the retained history to maxHistory', () => {
      const service = makeService({ maxHistory: 2 });
      for (let i = 0; i < 5; i += 1) {
        service.recordBuildRun({ pipeline: 'ci', status: 'success', durationMs: i });
      }

      const history = service.getHistory();
      expect(history).toHaveLength(2);
      expect(history.map((run) => run.durationMs)).toEqual([4, 3]);
      expect(service.getHistory(1)).toHaveLength(1);
      expect(service.getHistory(0)).toHaveLength(0);
      expect(service.getHistory(Number.NaN)).toHaveLength(2);
    });

    it('uses the injected clock for completedAt and recordedAt', () => {
      const service = makeService();
      const record = service.recordBuildRun({ pipeline: 'ci', status: 'success', durationMs: 10 });

      expect(record.completedAt).toBe(1_700_000_000_000);
      expect(record.recordedAt).toBe(1_700_000_000_000);
      expect(record.runId).toMatch(/^run-1700000000000-/);
    });

    it('honours an explicit completedAt and run metadata', () => {
      const service = makeService();
      const record = service.recordBuildRun({
        pipeline: 'ci',
        status: 'success',
        durationMs: 10,
        completedAt: 1_699_999_000_000,
        runId: 'gh-42',
        commitSha: 'abc123',
        branch: 'main',
      });

      expect(record.completedAt).toBe(1_699_999_000_000);
      expect(record.runId).toBe('gh-42');
      expect(service.getMetrics().lastCompletedAt).toBe(1_699_999_000_000);
      expect(service.getMetrics().lastSuccessAt).toBe(1_699_999_000_000);
      expect(service.getPipelineStats('ci')).toMatchObject({
        lastCommitSha: 'abc123',
        lastBranch: 'main',
      });
    });
  });

  describe('artifact budget', () => {
    it('flags artifacts over budget and exposes the ratio', () => {
      const service = makeService({ artifactBudgetBytes: 1_000 });

      const under = service.recordBuildRun({
        pipeline: 'ci',
        status: 'success',
        durationMs: 10,
        artifacts: [{ name: 'bundle.js', sizeBytes: 900 }],
      });
      const over = service.recordBuildRun({
        pipeline: 'ci',
        status: 'success',
        durationMs: 10,
        artifacts: [{ name: 'bundle.js', sizeBytes: 1_500 }],
      });

      expect(under.budgetBreached).toBe(false);
      expect(over.budgetBreached).toBe(true);
      expect(service.getMetrics().budgetBreaches).toBe(1);
      expect(service.getPipelineStats('ci')?.artifacts['bundle.js']).toEqual({
        lastSizeBytes: 1_500,
        maxSizeBytes: 1_500,
        breaches: 1,
      });
      expect(service.prometheusMetrics()).toContain(
        'subtrackr_build_artifact_budget_ratio{pipeline="ci",artifact="bundle.js"} 1.5',
      );
      expect(service.prometheusMetrics()).toContain('subtrackr_build_artifact_budget_bytes 1000');
    });

    it('disables budget enforcement when unset or non-positive', () => {
      const service = makeService({ artifactBudgetBytes: 0 });
      expect(service.getArtifactBudget()).toBeNull();

      const record = service.recordBuildRun({
        pipeline: 'ci',
        status: 'success',
        durationMs: 10,
        artifacts: [{ name: 'bundle.js', sizeBytes: 5_000 }],
      });

      expect(record.budgetBreached).toBe(false);
      expect(service.prometheusMetrics()).toContain('subtrackr_build_artifact_budget_bytes 0');
      expect(service.prometheusMetrics()).not.toContain('subtrackr_build_artifact_budget_ratio');

      service.setArtifactBudget(-5);
      expect(service.getArtifactBudget()).toBeNull();
      service.setArtifactBudget(2_000);
      expect(service.getArtifactBudget()).toBe(2_000);
      expect(service.prometheusMetrics()).toContain('subtrackr_build_artifact_budget_ratio');
    });
  });

  describe('beginBuild / endBuild', () => {
    it('measures the duration from the handle and decrements in-flight', () => {
      let clock = 1_700_000_000_000;
      const service = new BuildMetricsService({ now: () => clock });

      const handle = service.beginBuild('release', { runId: 'gh-7', branch: 'main' });
      expect(service.getInFlightCount()).toBe(1);
      expect(service.prometheusMetrics()).toContain(
        'subtrackr_build_in_progress{pipeline="release"} 1',
      );

      clock += 12_500;
      const record = service.endBuild(handle, { status: 'success' });

      expect(record.durationMs).toBe(12_500);
      expect(record.runId).toBe('gh-7');
      expect(record.branch).toBe('main');
      expect(service.getInFlightCount()).toBe(0);
      expect(service.getPipelineStats('release')?.inProgress).toBe(0);
      expect(service.getMetrics().inProgress).toBe(0);
    });

    it('prefers an explicit duration and carries stages and failure reasons', () => {
      let clock = 0;
      const service = new BuildMetricsService({ now: () => clock });
      const handle = service.beginBuild('ci');
      clock = 1_000;

      const record = service.endBuild(handle, {
        status: 'failure',
        durationMs: 42,
        failureReason: 'typecheck',
        stages: [{ stage: 'typecheck', durationMs: 42, status: 'failure' }],
      });

      expect(record.durationMs).toBe(42);
      expect(record.startedAt).toBe(0);
      expect(service.getPipelineStats('ci')?.failureReasons).toEqual({ typecheck: 1 });
    });

    it('never reports a negative duration for instant builds', () => {
      const service = new BuildMetricsService({ now: () => 5_000 });
      const handle = service.beginBuild('ci');
      const record = service.endBuild(handle, { status: 'success' });
      expect(record.durationMs).toBe(0);
    });

    it('rejects an unknown or already-consumed handle', () => {
      const service = makeService();
      const handle = service.beginBuild('ci');
      service.endBuild(handle, { status: 'success' });

      expect(() => service.endBuild(handle, { status: 'success' })).toThrow(
        BuildMetricsValidationError,
      );
      expect(() =>
        service.endBuild({ ...handle, token: 'ci:does-not-exist' }, { status: 'success' }),
      ).toThrow(/unknown build handle/);
      expect(service.getMetrics().rejectedRecords.validation).toBe(2);
      expect(service.getMetrics().totalRuns).toBe(1);
    });

    it('buckets failure reasons once the cardinality cap is reached', () => {
      const service = makeService({ maxFailureReasons: 2 });
      for (const reason of ['a', 'a', 'b', 'c', 'd']) {
        service.recordBuildRun({
          pipeline: 'ci',
          status: 'failure',
          durationMs: 10,
          failureReason: reason,
        });
      }

      expect(service.getPipelineStats('ci')?.failureReasons).toEqual({ a: 2, b: 1, other: 2 });
    });
  });

  describe('validation failures', () => {
    it('rejects runs with a missing pipeline', () => {
      const service = makeService();

      expect(() =>
        service.recordBuildRun({ status: 'success', durationMs: 1 } as never),
      ).toThrow(/requires a non-empty "pipeline"/);
      expect(() => service.recordBuildRun({ pipeline: '   ', status: 'success', durationMs: 1 })).toThrow(
        BuildMetricsValidationError,
      );
      expect(() => service.beginBuild('')).toThrow(/requires a non-empty "pipeline"/);
      expect(service.getMetrics().rejectedRecords.validation).toBe(3);
      expect(service.getMetrics().totalRuns).toBe(0);
    });

    it('rejects unknown statuses and unusable durations', () => {
      const service = makeService();

      expect(() =>
        service.recordBuildRun({ pipeline: 'ci', status: 'queued', durationMs: 1 } as never),
      ).toThrow(/status must be one of/);
      expect(() =>
        service.recordBuildRun({ pipeline: 'ci', status: 'success', durationMs: -1 }),
      ).toThrow(/non-negative/);
      expect(() =>
        service.recordBuildRun({ pipeline: 'ci', status: 'success', durationMs: Number.NaN }),
      ).toThrow(/non-negative/);
      expect(() =>
        service.recordBuildRun({
          pipeline: 'ci',
          status: 'success',
          durationMs: Number.POSITIVE_INFINITY,
        }),
      ).toThrow(/non-negative/);
      expect(() =>
        service.recordBuildRun(undefined as never),
      ).toThrow(/requires a non-empty "pipeline"/);

      expect(service.getMetrics().rejectedRecords.validation).toBe(5);
      expect(service.getMetrics().totalRuns).toBe(0);
      expect(service.getMetrics().trackedPipelines).toBe(0);
    });

    it('drops malformed nested stage and artifact entries', () => {
      const service = makeService();
      const record = service.recordBuildRun({
        pipeline: 'ci',
        status: 'success',
        durationMs: 10,
        stages: [
          { stage: 'lint', durationMs: 100, status: 'success' },
          { stage: '', durationMs: 50, status: 'success' },
          { stage: 'test', durationMs: -5, status: 'success' },
          null as never,
        ],
        artifacts: [
          { name: 'bundle.js', sizeBytes: 10 },
          { name: 'bundle.js', sizeBytes: Number.NaN },
          { name: '', sizeBytes: 10 },
        ],
      });

      expect(record.stages).toHaveLength(1);
      expect(record.artifacts).toHaveLength(1);
      expect(service.getMetrics().rejectedRecords).toEqual({
        validation: 0,
        malformedStage: 3,
        malformedArtifact: 2,
      });
      expect(service.getMetrics().totalRuns).toBe(1);
    });

    it('defaults a missing stage status to the run status', () => {
      const service = makeService();
      service.recordBuildRun({
        pipeline: 'ci',
        status: 'failure',
        durationMs: 10,
        stages: [{ stage: 'test', durationMs: 10 } as never],
      });

      expect(service.getPipelineStats('ci')?.stages['test']).toMatchObject({
        runs: 1,
        failures: 1,
      });
    });
  });

  describe('ingestBuildReport', () => {
    it('accepts { runs: [...] } and reports per-entry failures', () => {
      const service = makeService();
      const result = service.ingestBuildReport({
        generatedAt: '2026-01-01T00:00:00Z',
        runs: [
          { pipeline: 'ci', status: 'success', durationMs: '1200' },
          { pipeline: 'ci', status: 'success' },
          { status: 'success', durationMs: 10 },
          { pipeline: 'ci', status: 'nope', durationMs: 10 },
          { pipeline: 'ci', status: 'failure', durationMs: 'not-a-number' },
        ],
      });

      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]).toMatchObject({ pipeline: 'ci', durationMs: 1_200 });
      expect(result.rejected).toHaveLength(4);
      expect(result.rejected[0]).toEqual({
        index: 1,
        reason: 'build run requires a finite "durationMs"',
      });
      expect(result.rejected[1]?.reason).toMatch(/pipeline/);
      expect(result.rejected[2]?.reason).toMatch(/status must be one of/);
      expect(result.rejected[3]?.reason).toMatch(/durationMs/);
      expect(service.getMetrics().totalRuns).toBe(1);
      expect(service.getMetrics().rejectedRecords.validation).toBe(4);
    });

    it('accepts a bare array and a single run object', () => {
      const service = makeService();

      const fromArray = service.ingestBuildReport([
        { pipeline: 'a', status: 'success', durationMs: 1 },
        { pipeline: 'b', status: 'success', durationMs: 2 },
      ]);
      expect(fromArray.accepted).toHaveLength(2);

      const fromObject = service.ingestBuildReport({ pipeline: 'c', status: 'success', durationMs: 3 });
      expect(fromObject.accepted).toHaveLength(1);
      expect(service.getMetrics().trackedPipelines).toBe(3);
    });

    it('coerces snake_case and numeric-string CI fields', () => {
      const service = makeService();
      const result = service.ingestBuildReport({
        runs: [
          {
            pipeline: 'ci',
            status: 'failure',
            duration_ms: '2500',
            run_id: 91,
            commit_sha: 'deadbeef',
            ref: 'refs/heads/main',
            failure_reason: 'bundle-too-large',
            started_at: 1_699_999_000_000,
            completed_at: '1700001000000',
            stages: [{ stage: 'bundle', duration_ms: '1200' }],
            artifacts: [{ name: 'index.android.bundle', size_bytes: '5242880' }],
          },
        ],
      });

      expect(result.rejected).toHaveLength(0);
      expect(result.accepted[0]).toMatchObject({
        runId: '91',
        commitSha: 'deadbeef',
        branch: 'refs/heads/main',
        failureReason: 'bundle-too-large',
        completedAt: 1_700_001_000_000,
      });
      expect(result.accepted[0].stages).toEqual([
        { stage: 'bundle', durationMs: 1_200, status: 'failure' },
      ]);
      expect(result.accepted[0].artifacts).toEqual([
        { name: 'index.android.bundle', sizeBytes: 5_242_880 },
      ]);
    });

    it('folds CI-specific outcomes onto the three exported statuses', () => {
      const service = makeService();
      const result = service.ingestBuildReport({
        workflow_runs: [
          { pipeline: 'ci', conclusion: 'success', durationMs: 10 },
          { pipeline: 'ci', conclusion: 'timed_out', durationMs: 20 },
          { pipeline: 'ci', conclusion: 'action_required', durationMs: 30 },
          { pipeline: 'ci', conclusion: 'skipped', durationMs: 40 },
          { pipeline: 'ci', conclusion: 'CANCELLED', durationMs: 50 },
          { pipeline: 'ci', outcome: 'neutral', durationMs: 60 },
        ],
      });

      expect(result.rejected).toHaveLength(0);
      expect(result.accepted.map((r) => r.status)).toEqual([
        'success',
        'failure',
        'failure',
        'cancelled',
        'cancelled',
        'success',
      ]);
      expect(service.getMetrics().pipelines.ci).toMatchObject({
        totalRuns: 6,
        successRuns: 2,
        failureRuns: 2,
        cancelledRuns: 2,
      });
    });

    it('still rejects a status that is neither canonical nor a known alias', () => {
      const service = makeService();
      const result = service.ingestBuildReport([
        { pipeline: 'ci', conclusion: 'completed', durationMs: 10 },
      ]);

      expect(result.accepted).toHaveLength(0);
      expect(result.rejected[0].reason).toMatch(/conclusion/);
    });

    it('returns an empty result for unusable report shapes', () => {
      const service = makeService();

      expect(service.ingestBuildReport(null)).toEqual({ accepted: [], rejected: [] });
      expect(service.ingestBuildReport('runs').accepted).toHaveLength(0);
      expect(service.ingestBuildReport(42).accepted).toHaveLength(0);
      expect(service.ingestBuildReport({ runs: 'nope' }).accepted).toHaveLength(0);
      expect(service.ingestBuildReport({} as unknown as { runs: unknown }).accepted).toHaveLength(0);
      expect(service.getMetrics().totalRuns).toBe(0);
    });

    it('rejects array entries that are not objects', () => {
      const service = makeService();
      const result = service.ingestBuildReport([null, 'nope', { pipeline: 'ci', status: 'success', durationMs: 1 }]);

      expect(result.accepted).toHaveLength(1);
      expect(result.rejected.map((entry) => entry.reason)).toEqual([
        'build run must be an object',
        'build run must be an object',
      ]);
    });
  });

  describe('prometheusMetrics', () => {
    it('renders counters, gauges and percentiles per pipeline', () => {
      const service = makeService({ artifactBudgetBytes: 1_000 });
      service.recordBuildRun({
        pipeline: 'ci',
        status: 'success',
        durationMs: 1_000,
        runId: '1',
        commitSha: 'abc1234',
        branch: 'main',
        stages: [{ stage: 'lint', durationMs: 500, status: 'success' }],
        artifacts: [{ name: 'bundle.js', sizeBytes: 800 }],
      });
      service.recordBuildRun({
        pipeline: 'ci',
        status: 'failure',
        durationMs: 3_000,
        failureReason: 'test-failed',
      });

      const output = service.prometheusMetrics();
      const samples = parseExposition(output);

      expect(samples.get('subtrackr_build_runs_total')).toBe(2);
      expect(samples.get('subtrackr_build_success_runs_total')).toBe(1);
      expect(samples.get('subtrackr_build_failure_runs_total')).toBe(1);
      expect(samples.get('subtrackr_build_cancelled_runs_total')).toBe(0);
      expect(samples.get('subtrackr_build_pipelines')).toBe(1);
      expect(samples.get('subtrackr_build_runs_total{pipeline="ci",status="success"}')).toBe(1);
      expect(samples.get('subtrackr_build_runs_total{pipeline="ci",status="failure"}')).toBe(1);
      expect(samples.get('subtrackr_build_runs_total{pipeline="ci",status="cancelled"}')).toBe(0);
      expect(samples.get('subtrackr_build_duration_ms{pipeline="ci"}')).toBe(3_000);
      expect(samples.get('subtrackr_build_duration_p50_ms{pipeline="ci"}')).toBe(1_000);
      expect(samples.get('subtrackr_build_duration_p95_ms{pipeline="ci"}')).toBe(3_000);
      expect(samples.get('subtrackr_build_duration_p99_ms{pipeline="ci"}')).toBe(3_000);
      expect(samples.get('subtrackr_build_in_progress{pipeline="ci"}')).toBe(0);
      expect(samples.get('subtrackr_build_last_success_timestamp_seconds{pipeline="ci"}')).toBe(
        1_700_000_000,
      );
      expect(
        samples.get('subtrackr_build_info{pipeline="ci",commit="abc1234",branch="main"}'),
      ).toBe(1);
      expect(samples.get('subtrackr_build_stage_duration_ms{pipeline="ci",stage="lint"}')).toBe(500);
      expect(samples.get('subtrackr_build_stage_failures_total{pipeline="ci",stage="lint"}')).toBe(0);
      expect(
        samples.get('subtrackr_build_artifact_size_bytes{pipeline="ci",artifact="bundle.js"}'),
      ).toBe(800);
      expect(samples.get('subtrackr_build_budget_breaches_total{pipeline="ci",artifact="bundle.js"}')).toBe(0);
      expect(
        samples.get('subtrackr_build_artifact_budget_ratio{pipeline="ci",artifact="bundle.js"}'),
      ).toBe(0.8);
      expect(samples.get('subtrackr_build_failures_total{pipeline="ci",reason="test-failed"}')).toBe(1);
    });

    it('emits a valid document with HELP and TYPE for every family exactly once', () => {
      const service = makeService();
      service.recordBuildRun({
        pipeline: 'a',
        status: 'success',
        durationMs: 10,
        stages: [
          { stage: 'lint', durationMs: 5, status: 'success' },
          { stage: 'test', durationMs: 5, status: 'success' },
        ],
        artifacts: [
          { name: 'app.js', sizeBytes: 10 },
          { name: 'app.wasm', sizeBytes: 20 },
        ],
      });
      service.recordBuildRun({ pipeline: 'b', status: 'success', durationMs: 20 });

      const output = service.prometheusMetrics();
      const helps = output
        .split('\n')
        .filter((line) => line.startsWith('# HELP'))
        .map((line) => line.split(' ')[2]);
      const types = output
        .split('\n')
        .filter((line) => line.startsWith('# TYPE'))
        .map((line) => line.split(' ')[2]);

      expect(helps.length).toBeGreaterThan(0);
      expect(new Set(helps).size).toBe(helps.length);
      expect(types.sort()).toEqual(helps.sort());
      expect(output.endsWith('\n')).toBe(true);
      expect(parseExposition(output).size).toBe(
        output.split('\n').filter((line) => line !== '' && !line.startsWith('#')).length,
      );
    });

    it('reports aggregate counters with zero values on a fresh service', () => {
      const output = makeService().prometheusMetrics();

      expect(output).toContain('subtrackr_build_runs_total 0');
      expect(output).toContain('subtrackr_build_pipelines 0');
      expect(output).toContain('subtrackr_build_runs_rejected_total{reason="validation"} 0');
      expect(output).toContain('# TYPE subtrackr_build_runs_total counter');
    });

    it('escapes quotes, backslashes and newlines in label values', () => {
      const service = makeService();
      service.recordBuildRun({
        pipeline: 'ci"quoted"',
        status: 'failure',
        durationMs: 10,
        branch: 'feat\\x\nnext',
        failureReason: 'line1\nline2',
      });

      const output = service.prometheusMetrics();
      expect(output).toContain('pipeline="ci\\"quoted\\""');
      expect(output).toContain('branch="feat\\\\x\\nnext"');
      expect(output).toContain('reason="line1\\nline2"');
      expect(output).not.toContain('branch="feat\\x');
      expect(parseExposition(output).get(
        'subtrackr_build_runs_total{pipeline="ci\\"quoted\\"",status="success"}',
      )).toBe(0);
    });

    it('honours a custom namespace', () => {
      const service = makeService();
      service.recordBuildRun({ pipeline: 'ci', status: 'success', durationMs: 1 });

      const output = service.prometheusMetrics('acme_ci');
      expect(output).toContain('acme_ci_runs_total 1');
      expect(output).toContain('acme_ci_duration_ms{pipeline="ci"} 1');
      expect(output).not.toContain('subtrackr_build');
    });

    it('emits NaN rather than a misleading zero for an unsampled pipeline', () => {
      const service = makeService();
      service.beginBuild('ci');

      const samples = parseExposition(service.prometheusMetrics());
      expect(samples.get('subtrackr_build_duration_p95_ms{pipeline="ci"}')).toBeNaN();
      expect(samples.get('subtrackr_build_duration_p95_ms{pipeline="ci"}')).toBeNaN();
    });
  });

  describe('build completion sinks', () => {
    it('invokes sinks and supports unsubscribe', () => {
      const service = makeService();
      const seen: string[] = [];
      const unsubscribe = service.onBuildComplete((record) => seen.push(record.pipeline));

      service.recordBuildRun({ pipeline: 'a', status: 'success', durationMs: 1 });
      unsubscribe();
      service.recordBuildRun({ pipeline: 'b', status: 'success', durationMs: 1 });

      expect(seen).toEqual(['a']);
    });

    it('swallows sink errors and keeps recording', () => {
      const service = makeService();
      const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      service.onBuildComplete(() => {
        throw new Error('sink exploded');
      });

      expect(() =>
        service.recordBuildRun({ pipeline: 'a', status: 'success', durationMs: 1 }),
      ).not.toThrow();
      expect(service.getMetrics().totalRuns).toBe(1);

      errors.mockRestore();
      warn.mockRestore();
    });
  });

  describe('helpers', () => {
    it('escapes only the characters Prometheus reserves', () => {
      expect(escapeLabelValue('plain')).toBe('plain');
      expect(escapeLabelValue('a"b')).toBe('a\\"b');
      expect(escapeLabelValue('a\\b')).toBe('a\\\\b');
      expect(escapeLabelValue('a\nb')).toBe('a\\nb');
    });

    it('renders legal Prometheus sample values', () => {
      expect(sampleValue(1.5)).toBe('1.5');
      expect(sampleValue(Number.NaN)).toBe('NaN');
      expect(sampleValue(Number.POSITIVE_INFINITY)).toBe('+Inf');
      expect(sampleValue(Number.NEGATIVE_INFINITY)).toBe('-Inf');
      expect(sampleMs(1_500.4)).toBe('1500');
      expect(sampleMs(Number.NaN)).toBe('NaN');
    });

    it('computes nearest-rank percentiles', () => {
      expect(percentile([], 95)).toBeNaN();
      expect(percentile([10], 99)).toBe(10);
      expect(percentile([10, 20, 30, 40], 50)).toBe(20);
      expect(percentile([10, 20, 30, 40], 100)).toBe(40);
    });

    it('validates untrusted run payloads', () => {
      expect(parseBuildRunInput({ pipeline: 'ci', status: 'success', durationMs: 5 })).toMatchObject({
        pipeline: 'ci',
        status: 'success',
        durationMs: 5,
      });
      expect(() => parseBuildRunInput('nope')).toThrow(/must be an object/);
      expect(() => parseBuildRunInput({ status: 'success', durationMs: 5 })).toThrow(/pipeline/);
      expect(() => parseBuildRunInput({ pipeline: 'ci', status: 'x', durationMs: 5 })).toThrow(
        /status must be one of success, failure, cancelled/,
      );
      expect(() => parseBuildRunInput({ pipeline: 'ci', status: 'success' })).toThrow(/durationMs/);
      expect(() =>
        parseBuildRunInput({ pipeline: 'ci', status: 'success', durationMs: -1 }),
      ).toThrow(/must not be negative/);
    });
  });

  describe('lifecycle', () => {
    it('reset clears runs, in-flight builds and rejection counters', () => {
      const service = makeService();
      service.beginBuild('ci');
      expect(() =>
        service.recordBuildRun({ pipeline: 'ci', status: 'bogus', durationMs: 1 } as never),
      ).toThrow(BuildMetricsValidationError);
      service.recordBuildRun({ pipeline: 'ci', status: 'success', durationMs: 1 });

      service.reset();

      const metrics = service.getMetrics();
      expect(metrics.totalRuns).toBe(0);
      expect(metrics.trackedPipelines).toBe(0);
      expect(metrics.inProgress).toBe(0);
      expect(metrics.rejectedRecords).toEqual({
        validation: 0,
        malformedStage: 0,
        malformedArtifact: 0,
      });
      expect(service.getHistory()).toHaveLength(0);
      expect(service.prometheusMetrics()).toContain('subtrackr_build_runs_total 0');
    });

    it('exposes a configured singleton', () => {
      expect(buildMetricsService).toBeInstanceOf(BuildMetricsService);
      expect(typeof buildMetricsService.prometheusMetrics()).toBe('string');
    });
  });
});

describe('BuildMetricsService time-to-live guard', () => {
  it('does not let history grow without bound across many pipelines', () => {
    const service = new BuildMetricsService({ maxHistory: 10, now: () => 0 });
    for (let i = 0; i < 500; i += 1) {
      service.recordBuildRun({ pipeline: `p${i % 5}`, status: 'success', durationMs: i });
    }

    expect(service.getHistory(1000).length).toBeLessThanOrEqual(10);
    expect(service.getMetrics().totalRuns).toBe(500);
    expect(service.getMetrics().successRatePct).toBe(100);
  });

  it('keeps a stale in-flight build out of the success rate', () => {
    let clock = 0;
    const service = new BuildMetricsService({ now: () => clock });
    service.beginBuild('ci');
    clock += HOUR_MS;
    service.recordBuildRun({ pipeline: 'ci', status: 'success', durationMs: 10, completedAt: clock });

    expect(service.getMetrics()).toMatchObject({
      totalRuns: 1,
      successRuns: 1,
      successRatePct: 100,
      inProgress: 1,
      lastCompletedAt: HOUR_MS,
    });
  });
});
