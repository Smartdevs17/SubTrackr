/**
 * backend/src/services/subscriptions/index.ts
 *
 * Top-level barrel for the subscriptions service split.
 *
 * Three focused modules:
 *   pricing/   — price calculation, proration, plan templates, strategies, cache
 *   lifecycle/ — state transitions (cancel, pause/resume, trial), event store, SLA
 *   sync/      — CRDT engine, event log, projection
 *
 * Import from the module that owns the concept you need:
 *
 *   import { prorationService } from '.../subscriptions/pricing';
 *   import { cancellationService } from '.../subscriptions/lifecycle';
 *   import { syncEngineService } from '.../subscriptions/sync';
 *
 * Or import everything from this barrel when you need several modules at once:
 *
 *   import { pricing, lifecycle, sync } from '.../subscriptions';
 */

export * as pricing from './pricing';
export * as lifecycle from './lifecycle';
export * as sync from './sync';

// Observability — inject a real IMetricsRecorder in production
export { setMetricsRecorder, withSpan, MetricName } from './observability';
export type { IMetricsRecorder, MetricLabels, SpanResult } from './observability';

// Flatten the most-used exports to avoid double-namespace calls in hot paths.
// Add here only what multiple consumers will reach for directly.
export { prorationService, ProrationService }  from './pricing';
export { cancellationService, CancellationService } from './lifecycle';
export { pauseResumeService, PauseResumeService } from './lifecycle';
export { trialService, TrialService } from './lifecycle';
export { lifecycleEventStore, LifecycleEventStore } from './lifecycle';
export { slaMonitoringService, SlaMonitoringService } from './lifecycle';
export { syncEngineService, SyncEngineService } from './sync';
