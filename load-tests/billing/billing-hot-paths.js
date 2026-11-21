// k6 load test for read-heavy billing hot paths (Stripe billing router).
//
// Usage:
//   BASE_URL=https://staging.api.subtrackr.com \
//   API_TOKEN=... CUSTOMER_ID=cus_123 SUBSCRIPTION_ID=sub_123 \
//   k6 run load-tests/billing/billing-hot-paths.js
//
// Only read endpoints are exercised, so the script never creates charges,
// subscriptions or invoices in the target environment.

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_TOKEN = __ENV.API_TOKEN || '';
const CUSTOMER_ID = __ENV.CUSTOMER_ID || '';
const SUBSCRIPTION_ID = __ENV.SUBSCRIPTION_ID || '';
const BILLING_PATH = '/api/v1/stripe/billing';

const endpointLatency = new Trend('endpoint_latency', true);
const endpointErrors = new Rate('endpoint_errors');

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    endpoint_errors: ['rate<0.01'],
    'endpoint_latency{endpoint:subscription_get}': ['p(95)<500'],
    'endpoint_latency{endpoint:customer_subscriptions}': ['p(95)<500'],
    'endpoint_latency{endpoint:customer_invoices}': ['p(95)<500'],
    'endpoint_latency{endpoint:upcoming_invoice}': ['p(95)<500'],
  },
};

function headers() {
  const h = { Accept: 'application/json' };
  if (API_TOKEN) h.Authorization = `Bearer ${API_TOKEN}`;
  return { headers: h };
}

function getTimed(endpoint, path) {
  const res = http.get(`${BASE_URL}${BILLING_PATH}${path}`, {
    ...headers(),
    tags: { endpoint },
  });
  endpointLatency.add(res.timings.duration, { endpoint });
  const ok = check(res, {
    [`${endpoint} status is 200`]: (r) => r.status === 200,
  });
  endpointErrors.add(!ok);
  return res;
}

export default function () {
  group('billing read hot paths', () => {
    if (SUBSCRIPTION_ID) {
      getTimed('subscription_get', `/subscriptions/${SUBSCRIPTION_ID}`);
    }
    if (CUSTOMER_ID) {
      getTimed(
        'customer_subscriptions',
        `/customers/${CUSTOMER_ID}/subscriptions?limit=10`,
      );
      getTimed('customer_invoices', `/customers/${CUSTOMER_ID}/invoices?limit=10`);
      getTimed('upcoming_invoice', `/invoices/upcoming?customer=${CUSTOMER_ID}`);
    }
  });
  sleep(1);
}
