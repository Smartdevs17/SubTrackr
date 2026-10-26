/**
 * Payment job handlers — executed by the WFQ worker loop.
 */

import type { JobHandlerMap, QueueJob } from '../../shared/queue';
import {
  PAYMENT_JOB_NAMES,
  type ChargeSettlementPayload,
  type PaymentConfirmationPayload,
} from './paymentConfirmationJob';

export interface PaymentConfirmationResult {
  transactionId: string;
  sentAt: number;
  channel: 'email';
}

export type PaymentConfirmationHandler = (
  payload: PaymentConfirmationPayload,
) => Promise<PaymentConfirmationResult>;

/** Default handler — logs confirmation; swap for real email service in production. */
export const defaultPaymentConfirmationHandler: PaymentConfirmationHandler = async (payload) => {
  console.info(
    `[PaymentJob] Sending confirmation email for tx ${payload.transactionId} ` +
      `(subscriber=${payload.subscriberId}, amount=${payload.amount} ${payload.currency})`,
  );
  return {
    transactionId: payload.transactionId,
    sentAt: Date.now(),
    channel: 'email',
  };
};

async function handleConfirmationEmail(
  job: QueueJob<PaymentConfirmationPayload>,
  sendFn: PaymentConfirmationHandler,
): Promise<void> {
  await sendFn(job.data);
}

async function handleChargeSettlement(job: QueueJob<ChargeSettlementPayload>): Promise<void> {
  console.info(
    `[PaymentJob] Settling batch ${job.data.batchRunId} (${job.data.subscriptionIds.length} subscriptions)`,
  );
}

export function createPaymentJobHandlers(
  sendConfirmation: PaymentConfirmationHandler = defaultPaymentConfirmationHandler,
): JobHandlerMap {
  return {
    [PAYMENT_JOB_NAMES.CONFIRMATION_EMAIL]: (job) =>
      handleConfirmationEmail(job as QueueJob<PaymentConfirmationPayload>, sendConfirmation),
    [PAYMENT_JOB_NAMES.CHARGE_SETTLEMENT]: (job) =>
      handleChargeSettlement(job as QueueJob<ChargeSettlementPayload>),
  };
}
