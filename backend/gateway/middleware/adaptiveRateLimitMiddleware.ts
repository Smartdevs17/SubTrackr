/**
 * Adaptive rate-limit middleware (#615).
 *
 * Maintains a per-key sliding window of recent requests, scores the window with
 * the anomaly detector, derives an adaptive effective limit, enforces it, and
 * records the anomaly score for monitoring. Typed structurally so it works with
 * Express without importing it.
 */

import { decideLimit, type AdaptiveConfig, type LimitDecision } from "../adaptiveRateLimit";
import { type AnomalyDetector } from "../anomalyDetector";
import { type RequestSample } from "../featureExtraction";
import { type AnomalyMetrics } from "../../monitoring/anomalyMetrics";

export interface MinimalRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
}
export interface MinimalResponse {
  setHeader(name: string, value: string | number): void;
  status(code: number): MinimalResponse;
  json(body: unknown): void;
}
export type Next = () => void;

export interface MiddlewareOptions {
  detector: AnomalyDetector;
  config: AdaptiveConfig;
  metrics?: AnomalyMetrics;
  /** Sliding window length used for scoring. */
  windowSize?: number;
  /** Window duration in ms; counts reset per window. */
  windowMs?: number;
  /** Derive the rate-limit key (default: API key header or IP). */
  keyFn?: (req: MinimalRequest) => string;
  /** Clock injection for tests. */
  now?: () => number;
}

interface KeyState {
  samples: RequestSample[];
  windowStart: number;
  count: number;
}

function header(req: MinimalRequest, name: string): string {
  const v = req.headers[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function defaultKey(req: MinimalRequest): string {
  return header(req, "x-api-key") || req.ip || req.socket?.remoteAddress || "anonymous";
}

export function createAdaptiveRateLimitMiddleware(options: MiddlewareOptions) {
  const {
    detector,
    config,
    metrics,
    windowSize = 100,
    windowMs = 60_000,
    keyFn = defaultKey,
    now = () => Date.now(),
  } = options;

  const states = new Map<string, KeyState>();

  return function adaptiveRateLimit(req: MinimalRequest, res: MinimalResponse, next: Next): void {
    const ts = now();
    const key = keyFn(req);
    let state = states.get(key);
    if (!state || ts - state.windowStart >= windowMs) {
      state = { samples: [], windowStart: ts, count: 0 };
      states.set(key, state);
    }

    state.count += 1;
    state.samples.push({
      timestamp: ts,
      endpoint: req.path,
      payloadSize: Number(header(req, "content-length")) || 0,
      userAgent: header(req, "user-agent"),
      ip: req.ip || req.socket?.remoteAddress || "",
    });
    if (state.samples.length > windowSize) state.samples.shift();

    let decision: LimitDecision;
    if (detector.isFitted()) {
      const { score } = detector.scoreWindow(state.samples);
      metrics?.record(key, score, ts);
      decision = decideLimit({ key, score, path: req.path, config });
    } else {
      decision = decideLimit({ key, score: 0, path: req.path, config });
    }

    res.setHeader("X-RateLimit-Limit", decision.effectiveLimit);
    res.setHeader("X-Anomaly-Score", decision.anomalyScore.toFixed(4));
    res.setHeader("X-Anomaly-Action", decision.action);

    if (state.count > decision.effectiveLimit) {
      res.status(429).json({
        error: "rate_limited",
        reason: decision.action,
        anomalyScore: decision.anomalyScore,
        limit: decision.effectiveLimit,
      });
      return;
    }
    next();
  };
}
