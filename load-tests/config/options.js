export const options = {
  stages: [
    { duration: '30s', target: 50 }, // Ramp-up to 50 users over 30s
    { duration: '1m', target: 50 }, // Sustain at 50 users for 1m
    { duration: '30s', target: 0 }, // Ramp-down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must be below 500ms
    http_req_failed: ['rate<0.01'], // Error rate should be less than 1%
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
