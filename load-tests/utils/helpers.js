import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

export const BASE_URL = __ENV.BASE_URL || 'https://api.subtrackr.example.com';

export const commonHeaders = {
  'Content-Type': 'application/json',
  'api-key': __ENV.API_KEY || 'default-test-key',
};

// ── Per-endpoint custom metrics ────────────────────────────────────────────
// Tagged by `endpoint` so the report can attribute latency / error rate to a
// specific operation. This is the raw material for bottleneck identification:
// the endpoint with the highest p95 latency or error rate under load is the
// scalability bottleneck. See load-tests/SCALABILITY.md.
export const endpointLatency = new Trend('endpoint_latency', true);
export const endpointErrors = new Rate('endpoint_errors');
export const endpointRequests = new Counter('endpoint_requests');

export function randomString(length) {
  const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let res = '';
  while (length--) res += charset[(Math.random() * charset.length) | 0];
  return res;
}

/**
 * Validate a response and record per-endpoint metrics.
 * @param {object} res - k6 http response
 * @param {number} status - expected status code
 * @param {string} label - endpoint label used for metric tagging
 */
export function handleResponse(res, status = 200, label = 'unknown') {
  const tags = { endpoint: label };
  const success = check(
    res,
    {
      [`status is ${status}`]: (r) => r.status === status,
      'transaction time < 500ms': (r) => r.timings.duration < 500,
    },
    tags,
  );
  endpointLatency.add(res.timings.duration, tags);
  endpointErrors.add(!success, tags);
  endpointRequests.add(1, tags);
  return success;
}

export function generateSubscriptionData() {
  return JSON.stringify({
    name: `Test Sub ${randomString(5)}`,
    amount: Math.floor(Math.random() * 100) + 1,
    currency: 'USD',
    billingCycle: 'monthly',
  });
}
