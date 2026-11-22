/**
 * backend/src/sla — SLA monitoring with per-tier breach alerts and credit
 * issuance. See ./README.md.
 */

export { createSlaMonitor } from './monitor';
export type {
  SlaMonitor,
  SlaMonitorOptions,
  RecordRequestInput,
  OpenIncidentInput,
} from './monitor';
export { DEFAULT_SLA_TIERS, validateTierPolicy, buildTierMap } from './tiers';
export {
  periodBounds,
  evaluatePeriod,
  creditPercentFor,
  creditAmountFor,
  estimatePercentile,
  LATENCY_BUCKETS_MS,
} from './calculator';
export { SlaError } from './errors';
export type { SlaErrorCode } from './errors';
export type * from './types';
