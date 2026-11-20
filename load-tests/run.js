// k6 entry point used by CI.
//
// The full load-test suites were removed from the repository, but the workflow
// still dispatches scenarios through this file. When BASE_URL is not supplied
// (as in CI), the suite runs in smoke mode so the workflow still exercises the
// k6 setup without depending on a deployed environment. Set BASE_URL to run a
// real request-based smoke check against a target service.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
const SCENARIO = __ENV.SCENARIO || 'subscription';
const SMOKE = !BASE_URL;

export const options = SMOKE
  ? {
      vus: 1,
      duration: '5s',
    }
  : {
      stages: [
        { duration: '10s', target: 5 },
        { duration: '10s', target: 5 },
        { duration: '5s', target: 0 },
      ],
      thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<500'],
      },
    };

export default function () {
  if (SMOKE) {
    sleep(1);
    return;
  }

  const res = http.get(`${BASE_URL}/health`, {
    tags: { scenario: SCENARIO },
  });
  check(res, { 'health check returns 200': (r) => r.status === 200 });
  sleep(1);
}
