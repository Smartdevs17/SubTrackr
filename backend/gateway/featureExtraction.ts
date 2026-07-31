/**
 * Behavioral feature extraction for rate-limit anomaly detection (#615).
 *
 * Turns a window of recent requests (per API key / user) into a fixed-length
 * numeric feature vector for the Isolation Forest. Pure and side-effect free.
 */

export interface RequestSample {
  timestamp: number; // epoch ms
  endpoint: string;
  payloadSize: number; // bytes
  userAgent: string;
  ip: string;
}

export interface FeatureBreakdown {
  requestRate: number; // requests per second over the window
  endpointEntropy: number; // Shannon entropy of endpoint distribution (bits)
  timeOfDay: number; // 0..1 fraction of day of the latest request
  avgPayloadSize: number; // bytes
  userAgentEntropy: number; // entropy over user-agent strings (bits)
  geoSpread: number; // distinct IPs in the window
}

/** Order of features in the vector fed to the model. */
export const FEATURE_ORDER: (keyof FeatureBreakdown)[] = [
  "requestRate",
  "endpointEntropy",
  "timeOfDay",
  "avgPayloadSize",
  "userAgentEntropy",
  "geoSpread",
];

function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

function distribution<T>(items: T[], key: (t: T) => string): number[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.values()];
}

/** Extract an interpretable feature breakdown from a request window. */
export function extractFeatures(window: RequestSample[]): FeatureBreakdown {
  if (window.length === 0) {
    return {
      requestRate: 0,
      endpointEntropy: 0,
      timeOfDay: 0,
      avgPayloadSize: 0,
      userAgentEntropy: 0,
      geoSpread: 0,
    };
  }

  const timestamps = window.map((r) => r.timestamp);
  const minT = Math.min(...timestamps);
  const maxT = Math.max(...timestamps);
  const spanSec = Math.max((maxT - minT) / 1000, 1); // avoid div-by-zero / inflated rates
  const latest = new Date(maxT);
  const secondsIntoDay =
    latest.getUTCHours() * 3600 + latest.getUTCMinutes() * 60 + latest.getUTCSeconds();

  return {
    requestRate: window.length / spanSec,
    endpointEntropy: shannonEntropy(distribution(window, (r) => r.endpoint)),
    timeOfDay: secondsIntoDay / 86400,
    avgPayloadSize: window.reduce((a, r) => a + r.payloadSize, 0) / window.length,
    userAgentEntropy: shannonEntropy(distribution(window, (r) => r.userAgent)),
    geoSpread: new Set(window.map((r) => r.ip)).size,
  };
}

/** Convert a breakdown to the ordered numeric vector for the model. */
export function toVector(features: FeatureBreakdown): number[] {
  return FEATURE_ORDER.map((k) => features[k]);
}
