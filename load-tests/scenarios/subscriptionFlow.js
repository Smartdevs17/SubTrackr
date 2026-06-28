import { sleep } from 'k6';
import { createSubscription, getSubscriptions } from '../api/subscription.test.js';
import { simulateContractPayment } from '../contracts/contractLoad.test.js';
import { options } from '../config/options.js';

export { options };

export default function () {
  // 1. User signs up/logs in (implicit in headers)
  // 2. User creates a subscription
  createSubscription();
  sleep(1);

  // 3. System processes initial payment
  simulateContractPayment();
  sleep(1);

  // 4. User views their active subscriptions
  getSubscriptions();
  sleep(2);
}
