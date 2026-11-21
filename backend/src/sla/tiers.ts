/**
 * backend/src/sla/tiers.ts
 *
 * Default per-tier SLA policies and policy validation. Uptime targets match
 * the tier definitions in backend/services/shared/slaMonitoring.ts.
 */

import { SlaError } from './errors';
import type { SlaTierPolicy } from './types';

export const DEFAULT_SLA_TIERS: readonly SlaTierPolicy[] = [
  {
    tier: 'free',
    uptimeTargetPercent: 99.0,
    p95LatencyTargetMs: 5_000,
    errorRateTargetPercent: 5,
    creditSchedule: [],
    latencyBreachCreditPercent: 0,
    errorRateBreachCreditPercent: 0,
    maxCreditPercent: 0,
    breachAlertSeverity: 'info',
    atRiskBudgetPercent: 90,
  },
  {
    tier: 'basic',
    uptimeTargetPercent: 99.0,
    p95LatencyTargetMs: 5_000,
    errorRateTargetPercent: 2,
    creditSchedule: [
      { belowUptimePercent: 99.0, creditPercent: 5 },
      { belowUptimePercent: 95.0, creditPercent: 15 },
    ],
    latencyBreachCreditPercent: 0,
    errorRateBreachCreditPercent: 0,
    maxCreditPercent: 15,
    breachAlertSeverity: 'info',
    atRiskBudgetPercent: 80,
  },
  {
    tier: 'premium',
    uptimeTargetPercent: 99.5,
    p95LatencyTargetMs: 2_000,
    errorRateTargetPercent: 1,
    creditSchedule: [
      { belowUptimePercent: 99.5, creditPercent: 10 },
      { belowUptimePercent: 99.0, creditPercent: 25 },
      { belowUptimePercent: 95.0, creditPercent: 50 },
    ],
    latencyBreachCreditPercent: 5,
    errorRateBreachCreditPercent: 5,
    maxCreditPercent: 50,
    breachAlertSeverity: 'warning',
    atRiskBudgetPercent: 75,
  },
  {
    tier: 'enterprise',
    uptimeTargetPercent: 99.9,
    p95LatencyTargetMs: 1_000,
    errorRateTargetPercent: 0.5,
    creditSchedule: [
      { belowUptimePercent: 99.9, creditPercent: 10 },
      { belowUptimePercent: 99.0, creditPercent: 25 },
      { belowUptimePercent: 95.0, creditPercent: 100 },
    ],
    latencyBreachCreditPercent: 10,
    errorRateBreachCreditPercent: 10,
    maxCreditPercent: 100,
    breachAlertSeverity: 'critical',
    atRiskBudgetPercent: 50,
  },
];

const isPercent = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 100;

/** Throws `SlaError('invalid_policy')` if a policy is internally inconsistent. */
export function validateTierPolicy(policy: SlaTierPolicy): void {
  const fail = (why: string): never => {
    throw new SlaError('invalid_policy', `tier "${policy.tier}": ${why}`);
  };
  if (!policy.tier) fail('tier name is required');
  if (!isPercent(policy.uptimeTargetPercent)) fail('uptimeTargetPercent must be 0–100');
  if (!isPercent(policy.errorRateTargetPercent)) fail('errorRateTargetPercent must be 0–100');
  if (!(policy.p95LatencyTargetMs > 0)) fail('p95LatencyTargetMs must be positive');
  if (!isPercent(policy.maxCreditPercent)) fail('maxCreditPercent must be 0–100');
  if (!isPercent(policy.latencyBreachCreditPercent))
    fail('latencyBreachCreditPercent must be 0–100');
  if (!isPercent(policy.errorRateBreachCreditPercent))
    fail('errorRateBreachCreditPercent must be 0–100');
  if (!isPercent(policy.atRiskBudgetPercent)) fail('atRiskBudgetPercent must be 0–100');
  for (const step of policy.creditSchedule) {
    if (!isPercent(step.belowUptimePercent) || !isPercent(step.creditPercent)) {
      fail('credit steps must use 0–100 percentages');
    }
  }
  const sorted = [...policy.creditSchedule].sort(
    (a, b) => b.belowUptimePercent - a.belowUptimePercent
  );
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].creditPercent < sorted[i - 1].creditPercent) {
      fail('lower uptime steps must not credit less than higher ones');
    }
  }
}

/** Builds a tier lookup, validating each policy and rejecting duplicates. */
export function buildTierMap(policies: readonly SlaTierPolicy[]): Map<string, SlaTierPolicy> {
  const map = new Map<string, SlaTierPolicy>();
  for (const policy of policies) {
    validateTierPolicy(policy);
    if (map.has(policy.tier)) {
      throw new SlaError('invalid_policy', `tier "${policy.tier}" is defined twice`);
    }
    map.set(policy.tier, policy);
  }
  return map;
}
