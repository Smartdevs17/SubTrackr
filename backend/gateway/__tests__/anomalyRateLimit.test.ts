/**
 * Tests for the rate-limit anomaly detection gateway (#615).
 */

import { IsolationForest } from "../isolationForest";
import { extractFeatures, toVector } from "../featureExtraction";
import { AnomalyDetector } from "../anomalyDetector";
import { decideLimit, isAllowlisted, severityFor } from "../adaptiveRateLimit";
import { AnomalyMetrics } from "../../monitoring/anomalyMetrics";
import {
  createAdaptiveRateLimitMiddleware,
  type MinimalRequest,
} from "../middleware/adaptiveRateLimitMiddleware";
import type { RequestSample } from "../featureExtraction";

function normalVectors(): number[][] {
  // A "normal" cluster with spread in every dimension (constant dims would make
  // the forest pick degenerate splits and dilute discrimination).
  const out: number[][] = [];
  for (let i = 0; i < 200; i++) {
    out.push([
      1 + (i % 5) * 0.2,
      2 + (i % 3) * 0.3,
      0.4 + (i % 4) * 0.05,
      500 + (i % 7) * 10,
      0.1 + (i % 3) * 0.02,
      1 + (i % 2),
    ]);
  }
  return out;
}

describe("IsolationForest", () => {
  it("scores an outlier higher than an inlier", () => {
    const forest = new IsolationForest({ trees: 100, sampleSize: 128, seed: 7 }).fit(normalVectors());
    const inlier = forest.score([1, 2, 0.5, 500, 0.1, 1]);
    const outlier = forest.score([50, 9, 0.99, 90000, 5, 40]);
    expect(outlier).toBeGreaterThan(inlier);
    expect(inlier).toBeGreaterThanOrEqual(0);
    expect(outlier).toBeLessThanOrEqual(1);
  });

  it("is deterministic for a fixed seed", () => {
    const a = new IsolationForest({ seed: 1 }).fit(normalVectors()).score([1, 2, 0.5, 500, 0.1, 1]);
    const b = new IsolationForest({ seed: 1 }).fit(normalVectors()).score([1, 2, 0.5, 500, 0.1, 1]);
    expect(a).toBe(b);
  });
});

describe("featureExtraction", () => {
  function reqs(n: number, endpoint: string, spanMs: number): RequestSample[] {
    const out: RequestSample[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        timestamp: 1_700_000_000_000 + (i * spanMs) / n,
        endpoint,
        payloadSize: 100,
        userAgent: "agent/1",
        ip: "1.2.3.4",
      });
    }
    return out;
  }

  it("computes request rate and entropy", () => {
    const f = extractFeatures(reqs(60, "/a", 60_000));
    expect(f.requestRate).toBeGreaterThan(0);
    expect(f.endpointEntropy).toBe(0); // single endpoint => zero entropy
    expect(f.geoSpread).toBe(1);
    expect(toVector(f)).toHaveLength(6);
  });

  it("higher endpoint diversity raises entropy", () => {
    const mixed: RequestSample[] = [
      { timestamp: 1, endpoint: "/a", payloadSize: 1, userAgent: "x", ip: "1" },
      { timestamp: 2, endpoint: "/b", payloadSize: 1, userAgent: "y", ip: "2" },
      { timestamp: 3, endpoint: "/c", payloadSize: 1, userAgent: "z", ip: "3" },
    ];
    expect(extractFeatures(mixed).endpointEntropy).toBeGreaterThan(0);
    expect(extractFeatures(mixed).geoSpread).toBe(3);
  });

  it("handles an empty window", () => {
    expect(extractFeatures([]).requestRate).toBe(0);
  });
});

describe("decideLimit (adaptive limiting)", () => {
  const config = { baseLimit: 100, threshold: 0.8, severeThreshold: 0.95 };

  it("keeps the base limit below threshold", () => {
    const d = decideLimit({ key: "k", score: 0.3, config });
    expect(d.action).toBe("normal");
    expect(d.effectiveLimit).toBe(100);
  });

  it("reduces by 50% at the threshold", () => {
    const d = decideLimit({ key: "k", score: 0.85, config });
    expect(d.action).toBe("reduced");
    expect(d.effectiveLimit).toBe(50);
    expect(d.severity).toBe("medium");
  });

  it("reduces by 90% at the severe threshold", () => {
    const d = decideLimit({ key: "k", score: 0.97, config });
    expect(d.action).toBe("severely-reduced");
    expect(d.effectiveLimit).toBe(10);
    expect(d.severity).toBe("high");
  });

  it("allow-listed paths bypass reduction", () => {
    const d = decideLimit({
      key: "k",
      score: 0.99,
      path: "/webhooks/stripe",
      config: { ...config, allowlistPaths: ["/webhooks", "/health"] },
    });
    expect(d.action).toBe("allowlisted");
    expect(d.effectiveLimit).toBe(100);
  });

  it("per-key override wins (false-positive handling)", () => {
    const d = decideLimit({
      key: "trusted",
      score: 0.99,
      config: { ...config, overrides: { trusted: 5000 } },
    });
    expect(d.action).toBe("override");
    expect(d.effectiveLimit).toBe(5000);
  });

  it("isAllowlisted matches by prefix; severityFor buckets scores", () => {
    expect(isAllowlisted("/health/live", ["/health"])).toBe(true);
    expect(isAllowlisted("/api/x", ["/health"])).toBe(false);
    expect(severityFor(0.96, config)).toBe("high");
    expect(severityFor(0.81, config)).toBe("medium");
    expect(severityFor(0.1, config)).toBe("low");
  });
});

describe("AnomalyDetector", () => {
  // Realistic normal traffic varies window-to-window, which the model needs in
  // order to learn a distribution (identical windows give a degenerate forest).
  function normalWindow(w: number): RequestSample[] {
    const n = 40 + (w % 20); // ~40–60 requests/min
    const base = 1_700_000_000_000 + w * 60_000;
    const endpoints = w % 2 ? ["/api/subscriptions", "/api/usage"] : ["/api/subscriptions"];
    return Array.from({ length: n }, (_, i) => ({
      timestamp: base + Math.floor((i * 60_000) / n),
      endpoint: endpoints[i % endpoints.length],
      payloadSize: 350 + (i % 100),
      userAgent: "app/1.0",
      ip: "10.0.0.1",
    }));
  }

  it("scores anomalous windows higher than normal ones", () => {
    const detector = new AnomalyDetector({ seed: 3 }).fit(
      Array.from({ length: 60 }, (_, w) => normalWindow(w)),
    );

    const attackWindow: RequestSample[] = Array.from({ length: 5000 }, (_, i) => ({
      timestamp: 1_700_000_000_000 + i, // 5000 reqs in 5s = huge rate
      endpoint: `/api/ep${i % 50}`, // scanning many endpoints
      payloadSize: 50_000,
      userAgent: `bot/${i % 100}`, // rotating UAs
      ip: `192.168.${i % 255}.${i % 255}`, // distributed IPs
    }));

    const normal = detector.scoreWindow(normalWindow(3)).score;
    const attack = detector.scoreWindow(attackWindow).score;
    expect(attack).toBeGreaterThan(normal);
  });
});

describe("AnomalyMetrics", () => {
  it("tracks per-key score, max, and high-confidence count", () => {
    const m = new AnomalyMetrics(0.95);
    m.record("k1", 0.2);
    m.record("k2", 0.97);
    expect(m.scoreFor("k2")).toBe(0.97);
    const flat = m.getMetrics();
    expect(flat.anomaly_keys_tracked).toBe(2);
    expect(flat.anomaly_score_max).toBe(0.97);
    expect(flat.anomaly_high_confidence_total).toBe(1);
    expect(m.toPrometheus()).toContain('rate_limit_anomaly_score{key="k2"} 0.97');
  });
});

describe("adaptive rate-limit middleware", () => {
  function fakeReqRes(path: string, apiKey: string) {
    const req: MinimalRequest = {
      path,
      headers: { "x-api-key": apiKey, "user-agent": "app", "content-length": "100" },
      ip: "10.0.0.5",
    };
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string | number>,
      body: undefined as unknown,
      setHeader(n: string, v: string | number) {
        this.headers[n] = v;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(b: unknown) {
        this.body = b;
      },
    };
    return { req, res };
  }

  it("passes normal traffic and 429s once the (unfitted) base limit is exceeded", () => {
    const detector = new AnomalyDetector(); // not fitted -> score 0 -> base limit
    const mw = createAdaptiveRateLimitMiddleware({
      detector,
      config: { baseLimit: 3 },
      windowMs: 60_000,
    });

    let allowed = 0;
    let blocked = 0;
    for (let i = 0; i < 5; i++) {
      const { req, res } = fakeReqRes("/api/x", "key-A");
      mw(req, res, () => {
        allowed += 1;
      });
      if (res.statusCode === 429) blocked += 1;
    }
    expect(allowed).toBe(3);
    expect(blocked).toBe(2);
  });

  it("sets anomaly headers", () => {
    const detector = new AnomalyDetector();
    const mw = createAdaptiveRateLimitMiddleware({ detector, config: { baseLimit: 100 } });
    const { req, res } = fakeReqRes("/api/x", "key-B");
    mw(req, res, () => {});
    expect(res.headers["X-RateLimit-Limit"]).toBe(100);
    expect(res.headers["X-Anomaly-Action"]).toBe("normal");
  });
});
