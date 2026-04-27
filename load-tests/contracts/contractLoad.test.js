import http from 'k6/http';
import { sleep, check } from 'k6';
import { BASE_URL, commonHeaders } from '../utils/helpers.js';

// Mocking Soroban interaction through a backend proxy or simulator endpoint
export function simulateContractPayment() {
  const payload = JSON.stringify({
    contractId: 'CACX...123',
    method: 'execute_payment',
    args: { amount: 10, user: 'G...XYZ' },
  });

  const res = http.post(`${BASE_URL}/contracts/simulate-payment`, payload, {
    headers: Object.assign({}, commonHeaders, { 'X-Soroban-Simulation': 'true' }),
  });

  check(res, {
    'contract success': (r) => r.status === 200,
    'latency within bounds': (r) => r.timings.duration < 1500, // Contract interactions can be slower
  });
}

export default function () {
  simulateContractPayment();
  sleep(2);
}
