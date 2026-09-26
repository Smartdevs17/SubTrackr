import {
  WebhookDeliveryService,
  buildWebhookPayload,
  signWebhookPayload,
  verifyWebhookSignature,
  verifyWebhookSignatureAny,
} from '../webhook';
import type {
  WebhookEventInput,
  WebhookPlanSnapshot,
  WebhookSubscriptionSnapshot,
} from '../../../../src/types/webhook';
import { BillingCycle } from '../../../../src/types/subscription';

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

  it('truncates payloads over 1MB and ships a hash instead of failing', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
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

    expect(result?.delivery.status).toBe('delivered');
    expect(result?.delivery.payloadTruncated).toBe(true);
    expect(result?.delivery.payloadHash).toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(Buffer.byteLength(init.body as string, 'utf8')).toBeLessThanOrEqual(1_048_576);
    expect((init.headers as Record<string, string>)['X-SubTrackr-Payload-Truncated']).toBe('true');
  });

  it('uses the default fixed retry schedule (1m, 5m, 15m, ...) when no custom policy is set', async () => {
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
    });

    await service.deliverEvent(makeInput({ webhookId: webhook.id }));

    expect(sleepImpl).toHaveBeenCalledWith(60_000);
  });

  it('dedups deliveries with the same idempotency key within the 24h window', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.charged'],
      secretKey: 'secret',
    });

    const input = makeInput({ webhookId: webhook.id, idempotencyKey: 'fixed-key' });
    const first = await service.deliverEvent(input);
    expect(first?.delivery.status).toBe('delivered');

    const second = await service.deliverEvent(input);
    expect(second?.delivery.status).toBe('skipped');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('moves exhausted deliveries to the dead-letter queue and supports manual replay', async () => {
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
      retryPolicy: { maxRetries: 0, initialDelayMs: 10, maxDelayMs: 10, backoffFactor: 2 },
    });

    const result = await service.deliverEvent(makeInput({ webhookId: webhook.id }));
    expect(result?.delivery.status).toBe('failed');
    expect(result?.delivery.isDeadLettered).toBe(true);
    expect(service.listDeadLetters(webhook.id)).toHaveLength(1);

    const replayed = await service.replayDeadLetter(result!.delivery.id);
    expect(replayed.delivery.status).toBe('delivered');
    expect(service.listDeadLetters(webhook.id)).toHaveLength(0);
  });

  it('rotates signing secrets with an overlapping valid period', () => {
    const service = new WebhookDeliveryService({ fetchImpl: jest.fn() as unknown as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.charged'],
      secretKey: 'old-secret',
    });

    const payload = buildWebhookPayload(makeInput({ webhookId: webhook.id }));
    const oldSignature = signWebhookPayload(payload, 'old-secret');

    const rotated = service.rotateSecret(webhook.id, 'new-secret', 60_000);
    const newSignature = signWebhookPayload(payload, 'new-secret');

    expect(rotated.secretKey).toBe('new-secret');
    expect(rotated.secrets).toHaveLength(2);
    expect(rotated.secrets[0].validUntil).toBeDefined();
    // Both the old (within overlap) and new secret should verify.
    const { verifyWebhookSignatureAny } = jest.requireActual('../webhook');
    expect(verifyWebhookSignatureAny(rotated, oldSignature, payload)).toBe(true);
    expect(verifyWebhookSignatureAny(rotated, newSignature, payload)).toBe(true);
  });

  it('auto-disables a webhook when its endpoint returns 410 Gone', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 410 });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.charged'],
      secretKey: 'secret',
    });

    const result = await service.deliverEvent(makeInput({ webhookId: webhook.id }));

    expect(result?.delivery.status).toBe('failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(service.getWebhook(webhook.id)?.isPaused).toBe(true);
    expect(service.getWebhook(webhook.id)?.disabledReason).toBe('Endpoint returned 410 Gone');
  });

  it('enforces a configurable burst limit independent of the steady-state cap', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.charged'],
      secretKey: 'secret',
      rateLimit: { burstLimit: 1, burstWindowMs: 1_000, steadyPerMinute: 100 },
    });

    const first = await service.deliverEvent(makeInput({ webhookId: webhook.id }));
    const second = await service.deliverEvent(makeInput({ webhookId: webhook.id }));

    expect(first?.delivery.status).toBe('delivered');
    expect(second?.delivery.status).toBe('retrying');
    expect(second?.delivery.errorMessage).toMatch(/rate limited/i);
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

  // ── Wildcard Event Filtering (Issue #727) ────────────────────────────────────

  it('allows events matching a wildcard category pattern (subscription.*)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.*' as any],
      secretKey: 'secret',
    });

    // subscription.created should match subscription.*
    const result = await service.deliverEvent(
      makeInput({ webhookId: webhook.id, eventType: 'subscription.created' as any })
    );
    expect(result?.delivery.status).toBe('delivered');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('blocks events that do not match the wildcard category (subscription.* vs payment.failed)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.*' as any],
      secretKey: 'secret',
    });

    const result = await service.deliverEvent(
      makeInput({ webhookId: webhook.id, eventType: 'payment.failed' as any })
    );
    // deliverEvent returns null when the event is not allowed
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows all events with the global wildcard (*)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['*' as any],
      secretKey: 'secret',
    });

    const r1 = await service.deliverEvent(
      makeInput({ webhookId: webhook.id, eventType: 'subscription.created' as any })
    );
    const r2 = await service.deliverEvent(
      makeInput({ webhookId: webhook.id, eventType: 'payment.failed' as any, idempotencyKey: 'key-2' })
    );
    const r3 = await service.deliverEvent(
      makeInput({ webhookId: webhook.id, eventType: 'invoice.paid' as any, idempotencyKey: 'key-3' })
    );

    expect(r1?.delivery.status).toBe('delivered');
    expect(r2?.delivery.status).toBe('delivered');
    expect(r3?.delivery.status).toBe('delivered');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('blocks delivery to a paused webhook regardless of wildcard pattern', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['*' as any],
      secretKey: 'secret',
      isPaused: true,
    });

    const result = await service.deliverEvent(
      makeInput({ webhookId: webhook.id, eventType: 'subscription.created' as any })
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // ── Exponential Backoff Delay Calculation (Issue #727) ───────────────────────

  it('computes exponential backoff delays correctly across multiple attempts', async () => {
    const delays: number[] = [];
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const sleepImpl = jest.fn((ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch, sleepImpl });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.charged'],
      secretKey: 'secret',
      retryPolicy: {
        maxRetries: 3,
        initialDelayMs: 1_000,
        maxDelayMs: 60_000,
        backoffFactor: 2,
        // No retryDelaysMs — uses the exponential formula
      },
    });

    await service.deliverEvent(makeInput({ webhookId: webhook.id }));

    // Delay for attempt 1: initialDelayMs * factor^0 = 1000 * 1 = 1000
    // Delay for attempt 2: initialDelayMs * factor^1 = 1000 * 2 = 2000
    // Delay for attempt 3: initialDelayMs * factor^2 = 1000 * 4 = 4000
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  // ── Test Webhook Simulation (Issue #727) ─────────────────────────────────────

  it('testWebhook sends a simulated delivery and returns a delivery record', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.created' as any],
      secretKey: 'secret',
    });

    const result = await service.testWebhook(webhook.id, 'subscription.created' as any);

    expect(result.delivery.status).toBe('delivered');
    expect(result.delivery.webhookId).toBe(webhook.id);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // The delivery should carry the HMAC signature header
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-SubTrackr-Signature']).toBeDefined();
  });

  it('testWebhook bypasses idempotency — repeated calls all fire', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.created' as any],
      secretKey: 'secret',
    });

    // Fire the same event type three times — each gets a unique test payload id
    await service.testWebhook(webhook.id, 'subscription.created' as any);
    await service.testWebhook(webhook.id, 'subscription.created' as any);
    await service.testWebhook(webhook.id, 'subscription.created' as any);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('testWebhook accepts a custom payload override', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new WebhookDeliveryService({ fetchImpl: fetchImpl as typeof fetch });

    const webhook = service.registerWebhook({
      merchantId: 'merchant_1',
      url: 'https://example.com/webhook',
      events: ['subscription.created' as any],
      secretKey: 'secret',
    });

    const custom = { merchantId: 'override_merchant' };
    const result = await service.testWebhook(webhook.id, 'subscription.created' as any, custom);

    expect(result.delivery.status).toBe('delivered');
    expect(result.delivery.payload.merchantId).toBe('override_merchant');
  });
});
