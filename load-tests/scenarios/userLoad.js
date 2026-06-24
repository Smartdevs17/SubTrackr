import { sleep } from 'k6';
import { getSubscriptions } from '../api/subscription.test.js';
import { sustainedOptions } from '../config/options.js';

export const options = sustainedOptions;

export default function () {
  // Typical user behavior: check subscriptions and wait
  getSubscriptions();
  sleep(5);
}
