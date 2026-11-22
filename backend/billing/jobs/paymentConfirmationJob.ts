/**
 * Payment confirmation background jobs.
 *
 * Time-sensitive billing notifications — scheduled at critical priority.
 */

import type { PriorityClass, PriorityQueue, QueueJob } from '../../shared/queue';

export const PAYMENT_JOB_PRIORITY: PriorityClass = 'critical';

export const PAYMENT_JOB_NAMES = {
  CONFIRMATION_EMAIL: 'payment:confirmation-email',
  RECEIPT_GENERATION: 'payment:receipt-generation',
  CHARGE_SETTLEMENT: 'payment:charge-settlement',
} as const;

export type PaymentJobName = (typeof PAYMENT_JOB_NAMES)[keyof typeof PAYMENT_JOB_NAMES];

export interface PaymentConfirmationPayload {
  subscriptionId: string;
  subscriberId: string;
  merchantId: string;
  amount: number;
  currency: string;
  transactionId: string;
}

export interface ChargeSettlementPayload {
  batchRunId: string;
  subscriptionIds: string[];
}

export async function enqueuePaymentConfirmation(
  queue: PriorityQueue<PaymentConfirmationPayload>,
  payload: PaymentConfirmationPayload,
): Promise<QueueJob<PaymentConfirmationPayload>> {
  return queue.add(PAYMENT_JOB_NAMES.CONFIRMATION_EMAIL, payload);
}

export async function enqueueChargeSettlement(
  queue: PriorityQueue<ChargeSettlementPayload>,
  payload: ChargeSettlementPayload,
): Promise<QueueJob<ChargeSettlementPayload>> {
  return queue.add(PAYMENT_JOB_NAMES.CHARGE_SETTLEMENT, payload);
}
