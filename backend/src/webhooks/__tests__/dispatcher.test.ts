/**
 * backend/src/webhooks/__tests__/dispatcher.test.ts
 *
 * Unit tests for the webhook dispatcher JWT gate.
 * Run with: npx jest backend/src/webhooks/__tests__/dispatcher.test.ts
 */

import {
  DispatchError,
  validateDelivery,
  defaultSplitToken,
  createWebhookDispatcher,
  dispatchWebhook,
  type WebhookDelivery,
  type DispatcherConfig,
  type HandlerContext,
} from '../dispatcher';

// ?? Helpers ?????????????????????????????????????????????????????????????

function enc(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const NOW = 1_700_000_000;
const POLICY = {
  audiences: ['webhook-prod'],
  allowedOrigins: ['https://billing.example.com'],
  issuer: 'https://issuer.example.com',
};

function token(overrides: Record<string, unknown> = {}): string {
  const claims = {
    aud: 'webhook-prod',
    origin: 'https://billing.example.com',
    iss: 'https://issuer.example.com',
    exp: NOW + 600,
    ...overrides,
  };
  return `${enc({ alg: 'HS256' })}.${enc(claims)}.c2lnbmF0dXJl`;
}

function delivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'evt-1',
    type: 'invoice.paid',
    source: 'billing',
    payload: { amount: 100 },
    ...overrides,
  };
}

function makeHooks(verify = true) {
  const calls: Array<{ name: string; labels?: Readonly<Record<string, string>> }> = [];
  const logs: Array<{ level: string; message: string; ctx?: Readonly<Record<string, unknown>> }> = [];
  return {
    calls,
    logs,
    verifySignature: () => verify,
    metrics: { increment: (name: string, labels?: Readonly<Record<string, string>>) => calls.push({ name, labels }) },
    logger: {
      info: (m: string, ctx?: Readonly<Record<string, unknown>>) => logs.push({ level: 'info', message: m, ctx }),
      warn: (m: string, ctx?: Readonly<Record<string, unknown>>) => logs.push({ level: 'warn', message: m, ctx }),
    },
  };
}

// ?? validateDelivery ????????????????????????????????????????????????????

describe('validateDelivery', () => {
  it('accepts a valid delivery', () => {
    expect(() => validateDelivery(delivery())).not.toThrow();
  });

  it('rejects a missing id', () => {
    expect(() => validateDelivery(delivery({ id: '' }))).toThrow(DispatchError);
  });

  it('rejects a missing type', () => {
    expect(() => validateDelivery(delivery({ type: '' }))).toThrow(DispatchError);
  });

  it('rejects a missing source', () => {
    expect(() => validateDelivery(delivery({ source: '' }))).toThrow(DispatchError);
  });

  it('rejects an invalid payload', () => {
    expect(() => validateDelivery(delivery({ payload: null as unknown as Record<string, unknown> }))).toThrow(DispatchError);
  });
});

// ?? defaultSplitToken ???????????????????????????????????????????????????

describe('defaultSplitToken', () => {
  it('splits signing input from signature', () => {
    const parts = defaultSplitToken(token());
    expect(parts.signingInput.split('.')).toHaveLength(2);
    expect(parts.signature).toBe('c2lnbmF0dXJl');
  });

  it('rejects a malformed token', () => {
    expect(() => defaultSplitToken('a.b')).toThrow(DispatchError);
  });
});

// ?? Dispatch happy path ?????????????????????????????????????????????????

describe('createWebhookDispatcher - accepted deliveries', () => {
  it('dispatches a valid delivery to its handler', async () => {
    const received: HandlerContext[] = [];
    const hooks = makeHooks();
    const dispatcher = createWebhookDispatcher({
      policy: POLICY,
      handlers: { 'invoice.paid': (ctx) => { received.push(ctx); } },
      hooks,
    });
    // Dispatch uses the real clock, so the token must carry a far-future exp.
    const farFuture = token({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const result = await dispatcher.dispatch(farFuture, delivery());
    expect(result.dispatched).toBe(true);
    expect(result.handler).toBe('invoice.paid');
    expect(received.length).toBe(1);
    expect(received[0].matchedAudience).toBe('webhook-prod');
    expect(hooks.calls.some((c) => c.name === 'webhook.dispatch.accepted')).toBe(true);
  });

  it('passes normalized origin and claims into the handler context', async () => {
    let ctx: HandlerContext | undefined;
    const dispatcher = createWebhookDispatcher({
      policy: POLICY,
      handlers: { 'invoice.paid': (c) => { ctx = c; } },
    });
    const result = await dispatcher.dispatch(
      token({ exp: Math.floor(Date.now() / 1000) + 3600, origin: 'https://BILLING.EXAMPLE.COM/' }),
      delivery()
    );
    expect(result.dispatched).toBe(true);
    expect(ctx?.normalizedOrigin).toBe('https://billing.example.com');
    expect(ctx?.claims?.sub).toBeUndefined();
  });

  it('supports async handlers', async () => {
    const seen: string[] = [];
    const dispatcher = createWebhookDispatcher({
      policy: POLICY,
      handlers: { 'invoice.paid': async () => { seen.push('done'); } },
    });
    const result = await dispatcher.dispatch(token({ exp: Math.floor(Date.now() / 1000) + 3600 }), delivery());
    expect(result.dispatched).toBe(true);
    expect(seen).toEqual(['done']);
  });

  it('registers handlers dynamically', async () => {
    const dispatcher = createWebhookDispatcher({ policy: POLICY, handlers: {} });
    let called = false;
    dispatcher.registerHandler('invoice.paid', () => { called = true; });
    expect(dispatcher.handlerTypes()).toContain('invoice.paid');
    const result = await dispatcher.dispatch(token({ exp: Math.floor(Date.now() / 1000) + 3600 }), delivery());
    expect(result.dispatched).toBe(true);
    expect(called).toBe(true);
  });
});

// ?? Reject paths ????????????????????????????????????????????????????????

describe('createWebhookDispatcher - rejected deliveries', () => {
  function cfg(hooks: ReturnType<typeof makeHooks>): DispatcherConfig {
    return {
      policy: POLICY,
      handlers: { 'invoice.paid': () => {} },
      hooks,
    };
  }

  it('rejects when JWT claims fail', async () => {
    const hooks = makeHooks();
    const dispatcher = createWebhookDispatcher(cfg(hooks));
    const result = await dispatcher.dispatch(
      token({ exp: Math.floor(Date.now() / 1000) + 3600, aud: 'wrong' }),
      delivery()
    );
    expect(result.dispatched).toBe(false);
    expect(result.error?.code).toBe('JWT_REJECTED');
    expect(result.error?.details.code).toBe('INVALID_AUDIENCE');
    expect(hooks.calls.some((c) => c.name === 'webhook.dispatch.rejected')).toBe(true);
    expect(hooks.logs.some((l) => l.level === 'warn')).toBe(true);
  });

  it('rejects when the signature hook returns false', async () => {
    const hooks = makeHooks(false);
    const dispatcher = createWebhookDispatcher(cfg(hooks));
    const result = await dispatcher.dispatch(token({ exp: Math.floor(Date.now() / 1000) + 3600 }), delivery());
    expect(result.dispatched).toBe(false);
    expect(result.error?.code).toBe('SIGNATURE_INVALID');
  });

  it('rejects when no handler is registered (strict)', async () => {
    const dispatcher = createWebhookDispatcher(cfg(makeHooks()));
    const result = await dispatcher.dispatch(
      token({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      delivery({ type: 'unknown.event' })
    );
    expect(result.dispatched).toBe(false);
    expect(result.error?.code).toBe('NO_HANDLER');
  });

  it('skips cleanly when strictHandler is false', async () => {
    const dispatcher = createWebhookDispatcher({ ...cfg(makeHooks()), strictHandler: false });
    const result = await dispatcher.dispatch(
      token({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      delivery({ type: 'unknown.event' })
    );
    expect(result.dispatched).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('wraps thrown handler errors as HANDLER_FAILED', async () => {
    const dispatcher = createWebhookDispatcher({
      policy: POLICY,
      handlers: { 'invoice.paid': () => { throw new Error('boom'); } },
    });
    const result = await dispatcher.dispatch(token({ exp: Math.floor(Date.now() / 1000) + 3600 }), delivery());
    expect(result.dispatched).toBe(false);
    expect(result.error?.code).toBe('HANDLER_FAILED');
    expect(result.error?.details.message).toBe('boom');
  });

  it('rejects invalid deliveries before touching the token', async () => {
    const dispatcher = createWebhookDispatcher(cfg(makeHooks()));
    const result = await dispatcher.dispatch('garbage', delivery({ id: '' }));
    expect(result.error?.code).toBe('INVALID_DELIVERY');
  });
});

describe('dispatchWebhook convenience function', () => {
  it('dispatches in one shot', async () => {
    let called = false;
    const result = await dispatchWebhook(
      token({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      delivery(),
      { policy: POLICY, handlers: { 'invoice.paid': () => { called = true; } } }
    );
    expect(result.dispatched).toBe(true);
    expect(called).toBe(true);
  });
});
