/**
 * Adaptive rate-limit decision logic driven by anomaly scores (#615).
 *
 * When a key's behavioral anomaly score crosses the threshold, its effective
 * rate limit is reduced (moderately, then severely). Allow-listed paths
 * (webhook callbacks, health checks) bypass reduction, and per-key manual
 * overrides handle false positives. Pure decision function — the middleware
 * wraps it.
 */

export type LimitAction =
  | "normal"
  | "reduced"
  | "severely-reduced"
  | "allowlisted"
  | "override";

export type Severity = "low" | "medium" | "high";

export interface AdaptiveConfig {
  baseLimit: number;
  /** Score at/above which to reduce the limit (default 0.8). */
  threshold?: number;
  /** Score at/above which to reduce severely (default 0.95). */
  severeThreshold?: number;
  /** Fractional reduction at `threshold` (default 0.5 = -50%). */
  reduceModerate?: number;
  /** Fractional reduction at `severeThreshold` (default 0.9 = -90%). */
  reduceSevere?: number;
  /** Path prefixes that bypass adaptive reduction. */
  allowlistPaths?: string[];
  /** Per-key fixed limit overrides (manual false-positive handling). */
  overrides?: Record<string, number>;
}

export interface LimitDecision {
  key: string;
  anomalyScore: number;
  effectiveLimit: number;
  action: LimitAction;
  severity: Severity;
}

const DEFAULTS = {
  threshold: 0.8,
  severeThreshold: 0.95,
  reduceModerate: 0.5,
  reduceSevere: 0.9,
};

export function isAllowlisted(path: string, allowlist: string[] = []): boolean {
  return allowlist.some((p) => path === p || path.startsWith(p));
}

export function severityFor(score: number, config: AdaptiveConfig): Severity {
  const severe = config.severeThreshold ?? DEFAULTS.severeThreshold;
  const threshold = config.threshold ?? DEFAULTS.threshold;
  if (score >= severe) return "high";
  if (score >= threshold) return "medium";
  return "low";
}

export function decideLimit(params: {
  key: string;
  score: number;
  path?: string;
  config: AdaptiveConfig;
}): LimitDecision {
  const { key, score, path = "", config } = params;
  const threshold = config.threshold ?? DEFAULTS.threshold;
  const severeThreshold = config.severeThreshold ?? DEFAULTS.severeThreshold;
  const reduceModerate = config.reduceModerate ?? DEFAULTS.reduceModerate;
  const reduceSevere = config.reduceSevere ?? DEFAULTS.reduceSevere;
  const severity = severityFor(score, config);

  // Manual per-key override wins (false-positive handling).
  if (config.overrides && key in config.overrides) {
    return { key, anomalyScore: score, effectiveLimit: config.overrides[key], action: "override", severity };
  }

  // Allow-listed traffic is never throttled by the anomaly path.
  if (isAllowlisted(path, config.allowlistPaths)) {
    return { key, anomalyScore: score, effectiveLimit: config.baseLimit, action: "allowlisted", severity };
  }

  if (score >= severeThreshold) {
    return {
      key,
      anomalyScore: score,
      // "reduce by X%": keep base − ⌊base·X⌋ (avoids float drift, e.g. 100·0.1).
      effectiveLimit: config.baseLimit - Math.floor(config.baseLimit * reduceSevere),
      action: "severely-reduced",
      severity,
    };
  }
  if (score >= threshold) {
    return {
      key,
      anomalyScore: score,
      effectiveLimit: config.baseLimit - Math.floor(config.baseLimit * reduceModerate),
      action: "reduced",
      severity,
    };
  }
  return { key, anomalyScore: score, effectiveLimit: config.baseLimit, action: "normal", severity };
}
