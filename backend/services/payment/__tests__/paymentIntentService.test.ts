/**
 * PaymentIntentService lifecycle tests (Issues #1716, #1719).
 */

import {
  PaymentIntentService,
} from '../domain/paymentIntentService';
import {
  InMemoryPaymentIntentRepository,
} from '../domain/PaymentIntent';
import {
  AssetPolicyService,
  InMemoryAssetPolicyRepository,
} from '../domain/AssetPolicyService';
import { AssetNotAllowedError } from '../domain/AssetPolicyService';
import { AdvisoryLockService } from '../../shared/locking/AdvisoryLockService';

function makeService(): {
  service: PaymentIntentService;
  repo: InMemoryPaymentIntentRepository;
  policyService: AssetPolicyService;
} {
  const repo = new InMemoryPaymentIntentRepository();
  const policyService = new AssetPolicyService(new InMemoryAssetPolicyRepository());
  const service = new PaymentIntentService(
    repo,
    policyService,
    new AdvisoryLockService(),
  );
  return { service, repo, policyService };
}

describe('PaymentIntentService', () => {
  it('creates an intent with default ttl and confirmations', async () => {
    const { service } = makeService();

    const intent = await service.create({
      merchantId: 'mch_1',
      subscriberId: 'usr_1',
      amount: 10,
      asset: 'XLM',
      chain: 'stellar',
    });

    expect(intent.status).toBe('created');
    expect(intent.requiredConfirmations).toBe(1);
    expect(intent.confirmations).toBe(0);
    expect(intent.expiresAt).toBeGreaterThan(Date.now());
    expect(intent.webhookDeliveryIds).toEqual([]);
  });

  it('rejects creation when the merchant denylist blocks the asset', async () => {
    const { service, policyService } = makeService();
    await policyService.setPolicy('mch_1', [
      { merchantId: 'mch_1', chain: 'stellar', assetCode: 'XLM', mode: 'deny' },
    ]);

    await expect(
      service.create({
        merchantId: 'mch_1',
        subscriberId: 'usr_1',
        amount: 10,
        asset: 'XLM',
        chain: 'stellar',
      }),
    ).rejects.toThrow(AssetNotAllowedError);
  });

  it('walks the signature → submission → finality lifecycle', async () => {
    const { service } = makeService();
    const intent = await service.create({
      merchantId: 'mch_1',
      subscriberId: 'usr_1',
      amount: 10,
      asset: 'XLM',
      chain: 'stellar',
    });

    const signed = await service.attachSignature(intent.id, 'signed-xdr');
    expect(signed.status).toBe('awaiting_signature');
    expect(signed.signedXdr).toBe('signed-xdr');

    const submitted = await service.recordSubmission(intent.id, 'tx-hash-1');
    expect(submitted.status).toBe('pending_finality');
    expect(submitted.txHash).toBe('tx-hash-1');

    const partial = await service.recordConfirmation(intent.id, 0);
    expect(partial.status).toBe('pending_finality');

    const finalized = await service.recordConfirmation(intent.id, 2);
    expect(finalized.status).toBe('finalized');
    expect(finalized.confirmations).toBe(2);
  });

  it('finalizes as soon as required confirmations are reached', async () => {
    const { service } = makeService();
    const intent = await service.create({
      merchantId: 'mch_1',
      subscriberId: 'usr_1',
      amount: 10,
      asset: 'XLM',
      chain: 'stellar',
      requiredConfirmations: 3,
    });
    await service.recordSubmission(intent.id, 'tx-3');

    await service.recordConfirmation(intent.id, 2);
    const still = await service.get(intent.id);
    expect(still?.status).toBe('pending_finality');

    const done = await service.recordConfirmation(intent.id, 3);
    expect(done.status).toBe('finalized');
  });

  it('expires overdue intents and keeps fresh ones', async () => {
    const { service, repo } = makeService();
    const overdue = await service.create({
      merchantId: 'mch_1',
      subscriberId: 'usr_1',
      amount: 10,
      asset: 'XLM',
      chain: 'stellar',
      ttlSeconds: 60,
    });
    const fresh = await service.create({
      merchantId: 'mch_1',
      subscriberId: 'usr_1',
      amount: 20,
      asset: 'XLM',
      chain: 'stellar',
      ttlSeconds: 3600,
    });

    // Force the first intent into the past.
    await repo.update(overdue.id, { expiresAt: Date.now() - 1000 });

    const expired = await service.expireOverdue();
    expect(expired.map((i) => i.id)).toEqual([overdue.id]);
    expect((await service.get(overdue.id))?.status).toBe('expired');
    expect((await service.get(fresh.id))?.status).toBe('created');
  });

  it('cancels an intent but is idempotent for terminal states', async () => {
    const { service } = makeService();
    const intent = await service.create({
      merchantId: 'mch_1',
      subscriberId: 'usr_1',
      amount: 10,
      asset: 'XLM',
      chain: 'stellar',
    });

    const cancelled = await service.cancel(intent.id, 'user_request');
    expect(cancelled.status).toBe('cancelled');

    const again = await service.cancel(intent.id);
    expect(again.status).toBe('cancelled');
  });

  it('marks an intent failed', async () => {
    const { service } = makeService();
    const intent = await service.create({
      merchantId: 'mch_1',
      subscriberId: 'usr_1',
      amount: 10,
      asset: 'XLM',
      chain: 'stellar',
    });

    const failed = await service.markFailed(intent.id);
    expect(failed.status).toBe('failed');
  });

  it('throws when operating on a missing intent', async () => {
    const { service } = makeService();

    await expect(service.attachSignature('nope', 'xdr')).rejects.toThrow('not found');
    await expect(service.recordSubmission('nope', 'hash')).rejects.toThrow('not found');
    await expect(service.recordConfirmation('nope', 1)).rejects.toThrow('not found');
    await expect(service.cancel('nope')).rejects.toThrow('not found');
    await expect(service.markFailed('nope')).rejects.toThrow('not found');
  });

  it('exposes the repository for sweeps', () => {
    const { service, repo } = makeService();
    expect(service.getRepository()).toBe(repo);
  });
});
