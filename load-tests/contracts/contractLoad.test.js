import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL, commonHeaders, handleResponse } from '../utils/helpers.js';

// Mocking Soroban interaction through a backend proxy or simulator endpoint.
// Contract calls are tagged separately so the report can distinguish on-chain
// latency (which is expected to be higher) from plain API latency.
export function simulateContractPayment() {
  const payload = JSON.stringify({
    contractId: 'CACX...123',
    method: 'execute_payment',
    args: { amount: 10, user: 'G...XYZ' },
  });

  const res = http.post(`${BASE_URL}/contracts/simulate-payment`, payload, {
    headers: Object.assign({}, commonHeaders, { 'X-Soroban-Simulation': 'true' }),
    tags: { endpoint: 'contract_execute_payment' },
  });

  return handleResponse(res, 200, 'contract_execute_payment');
}

export function simulateContractCharge() {
  const payload = JSON.stringify({
    contractId: 'CACX...123',
    method: 'charge_subscription',
    args: { subscriptionId: Math.floor(Math.random() * 100000) },
  });

  const res = http.post(`${BASE_URL}/contracts/simulate-charge`, payload, {
    headers: Object.assign({}, commonHeaders, { 'X-Soroban-Simulation': 'true' }),
    tags: { endpoint: 'contract_charge_subscription' },
  });

  return handleResponse(res, 200, 'contract_charge_subscription');
}

export default function () {
  simulateContractPayment();
  sleep(1);
  simulateContractCharge();
  sleep(1);
}
