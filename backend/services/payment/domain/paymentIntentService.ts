/**
 * PaymentIntent service orchestrating lifecycle transitions.
 */

import { randomUUID } from 'crypto';
import {
  PaymentIntent,
  PaymentIntentCreateInput,
  PaymentIntentRepository,
  PaymentIntentStatus,
  getDefaultPaymentIntentRepository,
} from './PaymentIntent';
import { advisoryLockService } from '../../shared/locking/AdvisoryLockService';
import { AssetPolicyService, defaultAssetPolicyService } from './AssetPolicyService';

export class PaymentIntentService {
  constructor(
    private repo: PaymentIntentRepository = getDefaultPaymentIntentRepository(),
    private assetPolicyService: AssetPolicyService = defaultAssetPolicyService,
    private lockService = advisoryLockService
  ) {}

  /** Exposes the underlying repository for sweeps/queries (e.g. expiry job). */
  getRepository(): PaymentIntentRepository {
    return this.repo;
  }

  /** Replace the asset policy service (used by tests / DI container). */
  setAssetPolicyService(service: AssetPolicyService): void {
    this.assetPolicyService = service;
  }

  async create(input: PaymentIntentCreateInput): Promise<PaymentIntent> {
    await this.assetPolicyService.assertAllowed({
      merchantId: input.merchantId,
      chain: input.chain,
      asset: input.asset,
      issuer: input.issuer,
    });

    const now = Date.now();
    const ttlSeconds = input.ttlSeconds ?? 300;
    const expiresAt = input.expiresAt ?? now + ttlSeconds * 1000;
    const requiredConfirmations = input.requiredConfirmations ?? 1;

    const intent: PaymentIntent = {
      id: randomUUID(),
      merchantId: input.merchantId,
      subscriberId: input.subscriberId,
      subscriptionId: input.subscriptionId,
      amount: input.amount,
      asset: input.asset,
      issuer: input.issuer,
      chain: input.chain,
      status: 'created',
      unsignedXdr: input.unsignedXdr,
      signedXdr: undefined,
      txHash: undefined,
      requiredConfirmations,
      confirmations: 0,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
      webhookDeliveryIds: [],
    };

    return this.repo.create(intent);
  }

  async get(id: string): Promise<PaymentIntent | null> {
    return this.repo.get(id);
  }

  async attachSignature(id: string, signedXdr: string): Promise<PaymentIntent> {
    const existing = await this.repo.get(id);
    if (!existing) {
      throw new Error(`PaymentIntent ${id} not found`);
    }
    return this.repo.update(id, {
      signedXdr,
      status: 'awaiting_signature',
      updatedAt: Date.now(),
    });
  }

  async recordSubmission(id: string, txHash: string): Promise<PaymentIntent> {
    const existing = await this.repo.get(id);
    if (!existing) {
      throw new Error(`PaymentIntent ${id} not found`);
    }
    return this.repo.update(id, {
      txHash,
      status: 'pending_finality',
      updatedAt: Date.now(),
    });
  }

  async recordConfirmation(id: string, confirmations: number): Promise<PaymentIntent> {
    const existing = await this.repo.get(id);
    if (!existing) {
      throw new Error(`PaymentIntent ${id} not found`);
    }
    const status = confirmations >= (existing.requiredConfirmations || 1) ? 'finalized' : 'pending_finality';
    return this.repo.update(id, {
      confirmations,
      status,
      updatedAt: Date.now(),
    });
  }

  async expireOverdue(now = Date.now()): Promise<PaymentIntent[]> {
    const overdue = await this.repo.findOverdue(now, ['created', 'awaiting_signature']);
    const results: PaymentIntent[] = [];
    for (const intent of overdue) {
      const lockKey = intent.subscriptionId || intent.id;
      try {
        await this.lockService.withLock(lockKey, async () => {
          const fresh = await this.repo.get(intent.id);
          if (!fresh || fresh.status !== 'created' && fresh.status !== 'awaiting_signature') {
            return;
          }
          results.push(await this.repo.update(intent.id, { status: 'expired', updatedAt: Date.now() }));
        });
      } catch (err) {
        // ignore lock acquisition failures; let next tick retry
      }
    }
    return results;
  }

  async cancel(id: string, reason?: string): Promise<PaymentIntent> {
    const existing = await this.repo.get(id);
    if (!existing) {
      throw new Error(`PaymentIntent ${id} not found`);
    }
    if (existing.status === 'cancelled' || existing.status === 'expired' || existing.status === 'finalized') {
      return existing;
    }
    const lockKey = existing.subscriptionId || existing.id;
    return this.lockService.withLock(lockKey, async () => {
      const fresh = await this.repo.get(id);
      if (!fresh) {
        throw new Error(`PaymentIntent ${id} not found`);
      }
      if (fresh.status === 'cancelled' || fresh.status === 'expired' || fresh.status === 'finalized') {
        return fresh;
      }
      return this.repo.update(id, { status: 'cancelled', updatedAt: Date.now() });
    });
  }

  async markFailed(id: string): Promise<PaymentIntent> {
    const existing = await this.repo.get(id);
    if (!existing) {
      throw new Error(`PaymentIntent ${id} not found`);
    }
    return this.repo.update(id, { status: 'failed', updatedAt: Date.now() });
  }
}

export const paymentIntentService = new PaymentIntentService();
export const defaultPaymentIntentService = paymentIntentService;
