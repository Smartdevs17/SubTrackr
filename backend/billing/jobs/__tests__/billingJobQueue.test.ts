import { BillingJobQueue } from '../billingJobQueue';
import {
  PAYMENT_JOB_NAMES,
  type PaymentConfirmationPayload,
} from '../paymentConfirmationJob';
import type { QueueJob } from '../../../shared/queue';

describe('BillingJobQueue', () => {
  it('enqueues and processes payment confirmation end-to-end', async () => {
    const sent: string[] = [];
    const queue = new BillingJobQueue({
      connection: { host: 'localhost', port: 6379 },
      paymentHandlers: {
        [PAYMENT_JOB_NAMES.CONFIRMATION_EMAIL]: async (job: QueueJob<PaymentConfirmationPayload>) => {
          sent.push(job.data.transactionId);
        },
      },
    });

    await queue.schedulePaymentConfirmation({
      subscriptionId: 'sub_1',
      subscriberId: 'user_1',
      merchantId: 'merch_1',
      amount: 29.99,
      currency: 'USD',
      transactionId: 'tx_abc123',
    });

    const processed = await queue.processNext();
    expect(processed).toBe(true);
    expect(sent).toEqual(['tx_abc123']);
    expect(queue.scheduler.getStats().critical.totalProcessed).toBe(1);

    await queue.close();
  });

  it('processes critical payment before low analytics under load', async () => {
    const order: string[] = [];
    const queue = new BillingJobQueue({
      connection: { host: 'localhost', port: 6379 },
      paymentHandlers: {
        [PAYMENT_JOB_NAMES.CONFIRMATION_EMAIL]: async (job: QueueJob<PaymentConfirmationPayload>) => {
          order.push(`pay:${job.data.transactionId}`);
        },
      },
    });

    const scheduler = queue.scheduler;

    for (let i = 0; i < 5; i++) {
      await scheduler.enqueue('low', 'analytics:aggregate', { i });
    }
    await queue.schedulePaymentConfirmation({
      subscriptionId: 'sub_1',
      subscriberId: 'user_1',
      merchantId: 'merch_1',
      amount: 10,
      currency: 'USD',
      transactionId: 'tx_urgent',
    });

    await scheduler.processNext({
      [PAYMENT_JOB_NAMES.CONFIRMATION_EMAIL]: async (job: QueueJob<PaymentConfirmationPayload>) => {
        order.push(`pay:${job.data.transactionId}`);
      },
      'analytics:aggregate': async (job: QueueJob<{ i: number }>) => {
        order.push(`analytics:${job.data.i}`);
      },
    });

    expect(order[0]).toBe('pay:tx_urgent');

    await queue.close();
  });
});
