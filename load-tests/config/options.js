export const options = {
  stages: [
    { duration: '30s', target: 50 }, // Ramp-up to 50 users over 30s
    { duration: '1m', target: 50 }, // Sustain at 50 users for 1m
    { duration: '30s', target: 0 }, // Ramp-down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must be below 500ms
    http_req_failed: ['rate<0.01'], // Error rate should be less than 1%
    endpoint_errors: ['rate<0.01'], // Per-endpoint error rate
    // Per-endpoint latency budgets (drive bottleneck detection in CI).
    'endpoint_latency{endpoint:create_subscription}': ['p(95)<600'],
    'endpoint_latency{endpoint:list_subscriptions}': ['p(95)<400'],
    'endpoint_latency{endpoint:cancel_subscription}': ['p(95)<400'],
    'endpoint_latency{endpoint:contract_execute_payment}': ['p(95)<1500'],
    'endpoint_latency{endpoint:contract_charge_subscription}': ['p(95)<1500'],
  },
};

export const burstOptions = {
  stages: [
    { duration: '10s', target: 200 }, // Sudden spike to 200 users
    { duration: '30s', target: 200 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

export const sustainedOptions = {
  vus: 100,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<400'],
    http_req_failed: ['rate<0.01'],
  },
};
