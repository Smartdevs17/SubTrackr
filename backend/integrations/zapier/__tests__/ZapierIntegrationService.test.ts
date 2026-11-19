/**
 * Tests for the Zapier integration service.
 */

import {
  ZapierIntegrationService,
  ZAPIER_TRIGGER_DEFINITIONS,
  ZAPIER_ACTION_DEFINITIONS,
  type ZapierTriggerEvent,
  type ZapierActionResult,
} from '../ZapierIntegrationService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService() {
  const service = new ZapierIntegrationService();
  service.registerApiKey('merchant_001', 'api_key_abc123');
  return service;
}

function mockFetch(status = 200): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ZapierIntegrationService — API key management', () => {
  it('validates a registered API key', () => {
    const service = makeService();
    expect(service.validateApiKey('api_key_abc123')).toBe('merchant_001');
  });

  it('returns null for an unknown API key', () => {
    const service = makeService();
    expect(service.validateApiKey('unknown')).toBeNull();
  });
});

describe('ZapierIntegrationService — Hook subscriptions', () => {
  it('registers a hook and returns it with a signing secret', () => {
    const service = makeService();
    const hook = service.registerHook({
      merchantId: 'merchant_001',
      targetUrl: 'https://hooks.zapier.com/abc',
      event: 'subscription.created',
    });

    expect(hook.id).toMatch(/^zhook_/);
    expect(hook.event).toBe('subscription.created');
    expect(hook.targetUrl).toBe('https://hooks.zapier.com/abc');
    expect(hook.signingSecret).toHaveLength(64); // 32 bytes hex
    expect(hook.active).toBe(true);
  });

  it('lists hooks for a merchant', () => {
    const service = makeService();
    service.registerHook({ merchantId: 'merchant_001', targetUrl: 'https://a.com', event: 'payment.succeeded' });
    service.registerHook({ merchantId: 'merchant_001', targetUrl: 'https://b.com', event: 'payment.failed' });
    service.registerHook({ merchantId: 'merchant_002', targetUrl: 'https://c.com', event: 'renewal.upcoming' });

    expect(service.listHooks('merchant_001')).toHaveLength(2);
    expect(service.listHooks('merchant_002')).toHaveLength(1);
  });

  it('unregisters a hook', () => {
    const service = makeService();
    const hook = service.registerHook({
      merchantId: 'merchant_001',
      targetUrl: 'https://z.com',
      event: 'invoice.paid',
    });

    const removed = service.unregisterHook(hook.id, 'merchant_001');
    expect(removed).toBe(true);
    expect(service.listHooks('merchant_001')).toHaveLength(0);
  });

  it('returns false when unregistering a hook that belongs to another merchant', () => {
    const service = makeService();
    const hook = service.registerHook({
      merchantId: 'merchant_001',
      targetUrl: 'https://z.com',
      event: 'invoice.paid',
    });

    const removed = service.unregisterHook(hook.id, 'merchant_002');
    expect(removed).toBe(false);
    expect(service.getHook(hook.id)).toBeDefined();
  });
});

describe('ZapierIntegrationService — Event firing', () => {
  it('delivers an event to all matching active hooks', async () => {
    const service = makeService();
    const fetch = mockFetch(200);

    service.registerHook({ merchantId: 'merchant_001', targetUrl: 'https://hook1.com', event: 'subscription.created' });
    service.registerHook({ merchantId: 'merchant_001', targetUrl: 'https://hook2.com', event: 'subscription.created' });
    // Different event — should NOT fire
    service.registerHook({ merchantId: 'merchant_001', targetUrl: 'https://hook3.com', event: 'payment.failed' });

    const results = await service.fireEvent(
      'merchant_001',
      'subscription.created',
      { id: 'sub_001', name: 'Pro Plan' },
      fetch,
    );

    expect(results).toHaveLength(2);
    expect(results.every(r => r.success)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('marks delivery as failed when HTTP call fails', async () => {
    const service = makeService();
    const fetch = mockFetch(500);

    service.registerHook({ merchantId: 'merchant_001', targetUrl: 'https://hook.com', event: 'payment.failed' });

    const results = await service.fireEvent(
      'merchant_001',
      'payment.failed',
      { id: 'pay_001' },
      fetch,
    );

    expect(results[0]?.success).toBe(false);
  });

  it('auto-disables a hook after 10 consecutive failures', async () => {
    const service = makeService();
    const fetch = mockFetch(500);

    const hook = service.registerHook({
      merchantId: 'merchant_001',
      targetUrl: 'https://flaky.com',
      event: 'trial.ended',
    });

    for (let i = 0; i < 10; i++) {
      await service.fireEvent('merchant_001', 'trial.ended', {}, fetch);
    }

    const updated = service.getHook(hook.id);
    expect(updated?.active).toBe(false);
  });

  it('includes HMAC signature header in delivery request', async () => {
    const service = makeService();
    const fetch = mockFetch(200);

    service.registerHook({ merchantId: 'merchant_001', targetUrl: 'https://hook.com', event: 'invoice.created' });

    await service.fireEvent('merchant_001', 'invoice.created', { id: 'inv_001' }, fetch);

    const callHeaders = (fetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(callHeaders['X-SubTrackr-Zapier-Signature']).toBeTruthy();
    expect(callHeaders['X-SubTrackr-Event']).toBe('invoice.created');
  });
});

describe('ZapierIntegrationService — Actions', () => {
  it('returns error for an unknown action', () => {
    const service = makeService();
    const result = service.handleAction({
      merchantId: 'merchant_001',
      action: 'create_subscription',
      params: { userId: 'u_001', planId: 'plan_001' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported action');
  });

  it('calls a registered action handler', () => {
    const service = makeService();
    const handler = jest.fn((): ZapierActionResult => ({ success: true, id: 'sub_new' }));
    service.registerActionHandler('create_subscription', handler);

    const result = service.handleAction({
      merchantId: 'merchant_001',
      action: 'create_subscription',
      params: { userId: 'u_001', planId: 'plan_001' },
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe('sub_new');
    expect(handler).toHaveBeenCalledWith('merchant_001', { userId: 'u_001', planId: 'plan_001' });
  });

  it('wraps handler exceptions as failure results', () => {
    const service = makeService();
    service.registerActionHandler('cancel_subscription', () => {
      throw new Error('Subscription locked');
    });

    const result = service.handleAction({
      merchantId: 'merchant_001',
      action: 'cancel_subscription',
      params: { subscriptionId: 'sub_001' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Subscription locked');
  });
});

describe('ZapierIntegrationService — Payload signing', () => {
  it('produces consistent HMAC-SHA256 signatures', () => {
    const service = makeService();
    const sig1 = service.signPayload('{"test":1}', 'secret');
    const sig2 = service.signPayload('{"test":1}', 'secret');
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64);
  });

  it('verifyInboundSignature returns true for matching payload/secret', () => {
    const service = makeService();
    const body = '{"action":"cancel_subscription"}';
    const secret = 'shared-secret';
    const sig = service.signPayload(body, secret);
    expect(service.verifyInboundSignature(body, sig, secret)).toBe(true);
  });

  it('verifyInboundSignature returns false for tampered body', () => {
    const service = makeService();
    const sig = service.signPayload('original', 'secret');
    expect(service.verifyInboundSignature('tampered', sig, 'secret')).toBe(false);
  });
});

describe('ZapierIntegrationService — Catalog', () => {
  it('returns all trigger definitions', () => {
    const service = makeService();
    const triggers = service.getTriggerDefinitions();
    expect(triggers.length).toBe(ZAPIER_TRIGGER_DEFINITIONS.length);
    expect(triggers.every(t => t.key && t.label && t.samplePayload)).toBe(true);
  });

  it('returns all action definitions', () => {
    const service = makeService();
    const actions = service.getActionDefinitions();
    expect(actions.length).toBe(ZAPIER_ACTION_DEFINITIONS.length);
    expect(actions.every(a => a.key && a.label && Array.isArray(a.inputFields))).toBe(true);
  });

  it('every trigger has a unique key', () => {
    const keys = ZAPIER_TRIGGER_DEFINITIONS.map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
