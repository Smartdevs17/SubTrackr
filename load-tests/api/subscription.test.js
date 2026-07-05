import http from 'k6/http';
import { sleep } from 'k6';
import {
  BASE_URL,
  commonHeaders,
  generateSubscriptionData,
  handleResponse,
} from '../utils/helpers.js';

export function createSubscription() {
  const payload = generateSubscriptionData();
  const res = http.post(`${BASE_URL}/subscriptions`, payload, {
    headers: commonHeaders,
    tags: { endpoint: 'create_subscription' },
  });
  handleResponse(res, 201, 'create_subscription');
  return res.json();
}

export function getSubscriptions() {
  const res = http.get(`${BASE_URL}/subscriptions`, {
    headers: commonHeaders,
    tags: { endpoint: 'list_subscriptions' },
  });
  handleResponse(res, 200, 'list_subscriptions');
}

export function cancelSubscription(id) {
  const res = http.del(`${BASE_URL}/subscriptions/${id}`, null, {
    headers: commonHeaders,
    tags: { endpoint: 'cancel_subscription' },
  });
  handleResponse(res, 204, 'cancel_subscription');
}

export default function () {
  const sub = createSubscription();
  sleep(1);
  getSubscriptions();
  sleep(1);
  if (sub && sub.id) {
    cancelSubscription(sub.id);
  }
}
