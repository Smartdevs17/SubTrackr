import {
  WebhookDeliveryService,
  buildWebhookPayload,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../notification/webhook';
import type {
  WebhookEventInput,
  WebhookPlanSnapshot,
  WebhookSubscriptionSnapshot,
} from '../../../src/types/webhook';
import { BillingCycle } from '../../../src/types/subscription';

const makeSubscription = (
  overrides: Partial<WebhookSubscriptionSnapshot> = {}
): WebhookSubscriptionSnapshot => ({
  id: 'sub_1',
  planId: 'plan_1',
  subscriberId: 'user_1',
  status: 'active',
  startedAt: 1_700_000_000,
  lastChargedAt: 1_700_000_000,
  nextChargeAt: 1_700_086_400,
  totalPaid: 500,
  totalGasSpent: 10,
  chargeCount: 1,
  pausedAt: 0,
  pauseDuration: 0,
  refundRequestedAmount: 0,
  ...overrides,
});

const makePlan = (overrides: Partial<WebhookPlanSnapshot> = {}): WebhookPlanSnapshot => ({
  id: 'plan_1',
  merchantId: 'merchant_1',
  name: 'Pro',
  price: 500,
  token: 'USDC',
  interval: BillingCycle.MONTHLY,
  active: true,
  subscriberCount: 1,
  createdAt: 1_700_000_000,
  ...overrides,
});

const makeInput = (overrides: Partial<WebhookEventInput> = {}): WebhookEventInput => ({
  webhookId: 'whk_1',
  merchantId: 'merchant_1',
  eventType: 'subscription.charged',
  subscription: makeSubscription(),
  plan: makePlan(),
  previousStatus: 'active',
  currentStatus: 'active',
  occurredAt: 1_700_000_100,
  ...overrides,
});

describe('WebhookDeliveryService', () => {
  it('signs and verifies webhook payloads', () => {
    const payload = buildWebhookPayload(makeInput());
    const signature = signWebhookPayload(payload, 'secret');

    expect(verifyWebhookSignature(signature, payload, 'secret')).toBe(true);
    expect(verifyWebhookSignature(signature, payload, 'different-secret')).toBe(false);
  });

  it('delivers with exponential backoff until success', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch, sleepImpl });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.charged'],
      secretKey: 'secret',
      retryPolicy: {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 20,
        backoffFactor: 2,
      },
    });

    const result = await service.deliverEvent(makeInput({ webhookId: webhook.id }));

    expect(result?.delivery.status).toBe('delivered');
    expect(result?.delivery.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(10);
  });

  it('fails fast for payloads over 1MB', async () => {
    const fetchImpl = jest.fn();
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.charged'],
      secretKey: 'secret',
    });

    const giantSubscription = makeSubscription({
      totalPaid: 500,
      status: 'active',
      // Inflate the payload by using a large subscriber identifier.
      subscriberId: 'x'.repeat(1_050_000),
    });

    const result = await service.deliverEvent(
      makeInput({ webhookId: webhook.id, subscription: giantSubscription })
    );

    expect(result?.delivery.status).toBe('failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('supports manual retry after a failed delivery', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch, sleepImpl });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.charged'],
      secretKey: 'secret',
      retryPolicy: {
        maxRetries: 0,
        initialDelayMs: 10,
        maxDelayMs: 10,
        backoffFactor: 2,
      },
    });

    const first = await service.deliverEvent(makeInput({ webhookId: webhook.id }));
    expect(first?.delivery.status).toBe('failed');

    const retry = await service.retryWebhookDelivery(first!.delivery.id);
    expect(retry.delivery.status).toBe('delivered');
    expect(retry.delivery.attempts).toBeGreaterThanOrEqual(1);
  });
});
