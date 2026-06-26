/**
 * Billing job queue — wires payment/dunning jobs to the WFQ scheduler.
 */

import type { ConnectionOptions } from 'bullmq';
import {
  createJobQueueSystem,
  type JobHandlerMap,
  type JobQueueSystem,
  type QueueJob,
  type WeightedFairQueue,
} from '../../shared/queue';
import { createPaymentJobHandlers } from './paymentJobHandlers';
import {
  PAYMENT_JOB_PRIORITY,
  type ChargeSettlementPayload,
  type PaymentConfirmationPayload,
  enqueueChargeSettlement,
  enqueuePaymentConfirmation,
} from './paymentConfirmationJob';

export interface BillingJobQueueConfig {
  connection: ConnectionOptions;
  baseQueueName?: string;
  maxQueueSize?: number;
  paymentHandlers?: JobHandlerMap;
}

export class BillingJobQueue {
  private readonly system: JobQueueSystem;
  private readonly handlers: JobHandlerMap;

  constructor(config: BillingJobQueueConfig) {
    this.system = createJobQueueSystem({
      connection: config.connection,
      baseQueueName: config.baseQueueName ?? 'subtrackr:billing',
      maxQueueSize: config.maxQueueSize,
    });
    this.handlers = config.paymentHandlers ?? createPaymentJobHandlers();
  }

  get scheduler(): WeightedFairQueue {
    return this.system.scheduler;
  }

  /** Enqueue a payment confirmation at critical priority (with auto backpressure). */
  async schedulePaymentConfirmation(
    payload: PaymentConfirmationPayload,
  ): Promise<QueueJob<PaymentConfirmationPayload>> {
    return this.system.scheduler.enqueue(
      PAYMENT_JOB_PRIORITY,
      'payment:confirmation-email',
      payload,
    );
  }

  /** Enqueue charge settlement at critical priority. */
  async scheduleChargeSettlement(
    payload: ChargeSettlementPayload,
  ): Promise<QueueJob<ChargeSettlementPayload>> {
    return this.system.scheduler.enqueue(PAYMENT_JOB_PRIORITY, 'payment:charge-settlement', payload);
  }

  /** Process one job from the queue. */
  async processNext(): Promise<boolean> {
    return this.system.scheduler.processNext(this.handlers);
  }

  /** Start the background worker loop. */
  start(intervalMs = 50): void {
    this.system.scheduler.startProcessing(this.handlers, intervalMs);
  }

  stop(): void {
    this.system.scheduler.stopProcessing();
  }

  async close(): Promise<void> {
    await this.system.scheduler.close();
  }
}

// Re-export convenience enqueue functions that use WFQ
export { enqueuePaymentConfirmation, enqueueChargeSettlement };
