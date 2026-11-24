/**
 * backend/src/webhooks/providers/__tests__/index.test.ts
 *
 * Unit tests for declarative webhook provider routing (issue #2254).
 * Run with: npx jest backend/src/webhooks/providers/__tests__/index.test.ts
 */

import {
  HandlerError,
  WILDCARD_EVENT,
  createRouteRegistry,
  createDefaultRouteRegistry,
  createProviderRoutes,
  createStripeHandler,
  createPaypalHandler,
  createGithubHandler,
  compileRoute,
  matchRoute,
  normalizeProvider,
  normalizeEventType,
  routeKey,
  registerRoutes,
  BUILTIN_EVENT_TYPES,
  type ProviderHandlerContext,
  type WebhookRoute,
  type RouteRegistry,
  type NormalizedWebhookEvent,
} from '../index';
import {
  createWebhookDispatcher,
  createDeclarativeDispatcher,
  type WebhookDelivery,
} from '../../dispatcher';

// ?? Helpers ?????????????????????????????????????????????????????????????

function ctx(overrides: Partial<ProviderHandlerContext> = {}): ProviderHandlerContext {
  return {
    provider: 'stripe',
    eventType: 'charge.succeeded',
    delivery: {
      id: 'evt-1',
      type: 'charge.succeeded',
      source: 'stripe',
      payload: {},
    },
    ...overrides,
  };
}

function makeHooks() {
  const metrics: Array<{ name: string; labels?: Readonly<Record<string, string>> }> = [];
  const logs: Array<{ level: string; message: string }> = [];
  return {
    metrics,
    logs,
    hooks: {
      increment: (name: string, labels?: Readonly<Record<string, string>>) => metrics.push({ name, labels }),
      info: (message: string) => logs.push({ level: 'info', message }),
      warn: (message: string) => logs.push({ level: 'warn', message }),
    },
  };
}

function delivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'evt-1',
    type: 'charge.succeeded',
    source: 'stripe',
    payload: { data: { object: { id: 'ch_1', amount_received: 4200, currency: 'usd', status: 'succeeded', created: 1700000000 } } },
    ...overrides,
  };
}

function enc(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(): string {
  const claims = {
    aud: 'webhook-prod',
    origin: 'https://billing.example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return `${enc({ alg: 'HS256' })}.${enc(claims)}.c2lnbmF0dXJl`;
}

const POLICY = {
  audiences: ['webhook-prod'],
  allowedOrigins: ['https://billing.example.com'],
};

// ?? Normalization helpers ????????????????????????????????????????????????

describe('normalization helpers', () => {
  it('normalizes provider names and rejects empty ones', () => {
    expect(normalizeProvider('  Stripe ')).toBe('stripe');
    expect(() => normalizeProvider('')).toThrow(HandlerError);
  });

  it('normalizes event types and maps empty values to the wildcard', () => {
    expect(normalizeEventType(' invoice.paid ')).toBe('invoice.paid');
    expect(normalizeEventType(undefined)).toBe(WILDCARD_EVENT);
    expect(normalizeEventType('')).toBe(WILDCARD_EVENT);
  });

  it('builds canonical route keys', () => {
    expect(routeKey('Stripe', 'invoice.paid')).toBe('stripe::invoice.paid');
    expect(routeKey('github', undefined)).toBe('github::*');
  });

  it('compiles routes into frozen canonical descriptors', () => {
    const compiled = compileRoute({ provider: ' PayPal ', handler: () => {} });
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(compiled.provider).toBe('paypal');
    expect(compiled.eventType).toBe(WILDCARD_EVENT);
    expect(compiled.priority).toBe(0);
    expect(compiled.key).toBe('paypal::*');
  });

  it('rejects routes with a non-function handler', () => {
    expect(() => compileRoute({ provider: 'stripe', handler: undefined as unknown as () => void })).toThrow(HandlerError);
  });
});

// ?? Registration ????????????????????????????????????????????????????????

describe('createRouteRegistry - registration', () => {
  it('starts empty with a frozen default config', () => {
    const registry = createRouteRegistry();
    expect(registry.size()).toBe(0);
    expect(registry.config.onDuplicate).toBe('error');
    expect(Object.isFrozen(registry.config)).toBe(true);
    expect(registry.handlers()).toHaveLength(0);
  });

  it('registers a route and exposes a frozen descriptor', () => {
    const registry = createRouteRegistry();
    const route = registry.register({ provider: 'stripe', eventType: 'charge.succeeded', handler: () => {}, name: 'stripe-charge' });
    expect(registry.size()).toBe(1);
    expect(route.key).toBe('stripe::charge.succeeded');
    expect(route.name).toBe('stripe-charge');
    expect(Object.isFrozen(route)).toBe(true);
    expect(registry.has('stripe', 'charge.succeeded')).toBe(true);
    expect(registry.has('stripe', 'unknown.event')).toBe(false);
    expect(registry.providers()).toContain('stripe');
  });

  it('returns a frozen snapshot of all handlers', () => {
    const registry = createRouteRegistry({ routes: createProviderRoutes() });
    const snapshot = registry.handlers();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toHaveLength(10);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
  });

  it('seeds routes supplied in config', () => {
    const registry = createRouteRegistry({ routes: [{ provider: 'github', eventType: 'push', handler: () => {} }] });
    expect(registry.size()).toBe(1);
    expect(registry.has('github', 'push')).toBe(true);
    expect(Object.isFrozen(registry.config)).toBe(true);
  });

  it('appends routes through registerRoutes', () => {
    const registry = createRouteRegistry();
    const added = registerRoutes(registry, createProviderRoutes());
    expect(added).toBe(10);
    expect(registry.size()).toBe(10);
  });

  it('rejects a non-array seed route list', () => {
    expect(() => createRouteRegistry({ routes: 'nope' as unknown as WebhookRoute[] })).toThrow(HandlerError);
  });
});

// ?? Duplicate handling ???????????????????????????????????????????????????

describe('createRouteRegistry - duplicate policies', () => {
  const route = (name: string): WebhookRoute => ({ provider: 'stripe', eventType: 'invoice.paid', name, handler: () => {} });

  it('rejects duplicates by default with a DUPLICATE_ROUTE error', () => {
    const registry = createRouteRegistry();
    registry.register(route('first'));
    let code: string | undefined;
    try { registry.register(route('second')); } catch (err) { code = (err as HandlerError).code; }
    expect(code).toBe('DUPLICATE_ROUTE');
    expect(registry.size()).toBe(1);
  });

  it('keeps the first route when configured', () => {
    const registry = createRouteRegistry({ onDuplicate: 'keepFirst' });
    const first = registry.register(route('first'));
    const again = registry.register(route('second'));
    expect(again).toBe(first);
    expect(registry.size()).toBe(1);
    expect(registry.handlers()[0].name).toBe('first');
  });

  it('replaces the route when configured', () => {
    const registry = createRouteRegistry({ onDuplicate: 'replace' });
    registry.register(route('first'));
    registry.register(route('second'));
    expect(registry.size()).toBe(1);
    expect(registry.handlers()[0].name).toBe('second');
  });

  it('rejects providers outside the allow-list', () => {
    const registry = createRouteRegistry({ allowedProviders: ['stripe'] });
    let code: string | undefined;
    try { registry.register({ provider: 'evil', handler: () => {} }); } catch (err) { code = (err as HandlerError).code; }
    expect(code).toBe('PROVIDER_NOT_ALLOWED');
    expect(registry.size()).toBe(0);
  });

  it('rejects an unknown duplicate policy at construction', () => {
    expect(() => createRouteRegistry({ onDuplicate: 'bogus' as 'error' })).toThrow(HandlerError);
  });
});

// ?? Matching ????????????????????????????????????????????????????????????

describe('route matching', () => {
  function registry(): RouteRegistry {
    return createRouteRegistry({
      routes: [
        { provider: 'stripe', eventType: WILDCARD_EVENT, name: 'stripe-wildcard', handler: () => {} },
        { provider: 'stripe', eventType: 'invoice.paid', name: 'stripe-invoice', handler: () => {} },
        { provider: 'paypal', eventType: 'PAYMENT.CAPTURE.COMPLETED', name: 'paypal-capture', handler: () => {} },
      ],
    });
  }

  it('prefers an exact event route over a wildcard', () => {
    const match = registry().match('stripe', 'invoice.paid');
    expect(match?.route.name).toBe('stripe-invoice');
    expect(match?.wildcard).toBe(false);
    expect(Object.isFrozen(match)).toBe(true);
  });

  it('falls back to a wildcard for unlisted events', () => {
    const match = registry().match('stripe', 'charge.succeeded');
    expect(match?.route.name).toBe('stripe-wildcard');
    expect(match?.wildcard).toBe(true);
  });

  it('matches providers case-insensitively but exact events case-sensitively', () => {
    expect(registry().match('STRIPE', 'invoice.paid')?.route.name).toBe('stripe-invoice');
    // The exact route does not match different casing, so the wildcard applies.
    expect(registry().match('stripe', 'INVOICE.PAID')?.route.name).toBe('stripe-wildcard');
  });

  it('returns undefined for an unknown provider or empty event', () => {
    expect(registry().match('unknown', 'invoice.paid')).toBeUndefined();
    expect(registry().match('stripe', '')).toBeUndefined();
  });

  it('throws for an invalid provider', () => {
    expect(() => registry().match('', 'invoice.paid')).toThrow(HandlerError);
  });

  it('honours priority among equal-specificity wildcards', () => {
    const routes: WebhookRoute[] = [
      { provider: 'stripe', eventType: WILDCARD_EVENT, name: 'low', priority: 1, handler: () => {} },
      { provider: 'stripe', eventType: WILDCARD_EVENT, name: 'high', priority: 9, handler: () => {} },
    ];
    expect(matchRoute(routes, 'stripe', 'anything')?.route.name).toBe('high');
  });

  it('exposes a pure standalone matchRoute', () => {
    const routes = createProviderRoutes();
    expect(matchRoute(routes, 'github', 'push')?.route.name).toBe('github:push');
    expect(matchRoute(routes, 'github', 'unknown')?.route.name).toBe('github:*');
    expect(matchRoute(routes, 'bitbucket', 'push')).toBeUndefined();
  });
});

// ?? Removal ?????????????????????????????????????????????????????????????

describe('createRouteRegistry - removal', () => {
  it('unregisters an exact route', () => {
    const registry = createRouteRegistry({ routes: [{ provider: 'stripe', eventType: 'invoice.paid', handler: () => {} }] });
    expect(registry.unregister('stripe', 'invoice.paid')).toBe(true);
    expect(registry.unregister('stripe', 'invoice.paid')).toBe(false);
    expect(registry.size()).toBe(0);
  });

  it('unregisters every route for a provider', () => {
    const registry = createRouteRegistry();
    registerRoutes(registry, createProviderRoutes());
    expect(registry.unregister('stripe')).toBe(true);
    expect(registry.has('stripe')).toBe(false);
    expect(registry.has('paypal')).toBe(true);
  });

  it('clears the registry', () => {
    const registry = createRouteRegistry({ routes: createProviderRoutes() });
    registry.clear();
    expect(registry.size()).toBe(0);
    expect(registry.handlers()).toHaveLength(0);
  });
});

// ?? Built-in handlers ????????????????????????????????????????????????????

describe('built-in provider handlers', () => {
  it('normalizes a Stripe event into the sink', async () => {
    const events: NormalizedWebhookEvent[] = [];
    const handler = createStripeHandler((event) => { events.push(event); });
    await handler(ctx({
      delivery: {
        id: 'evt-1',
        type: 'charge.succeeded',
        source: 'stripe',
        payload: { data: { object: { id: 'ch_1', amount_received: 4200, currency: 'usd', status: 'succeeded', created: 1700000000 } } },
      },
    }));
    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe('stripe');
    expect(events[0].subject).toBe('ch_1');
    expect(events[0].amount).toBe(4200);
    expect(events[0].currency).toBe('usd');
    expect(Object.isFrozen(events[0])).toBe(true);
  });

  it('normalizes a PayPal event into the sink', async () => {
    const events: NormalizedWebhookEvent[] = [];
    const handler = createPaypalHandler((event) => { events.push(event); });
    await handler(ctx({
      provider: 'paypal',
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      delivery: {
        id: 'evt-2',
        type: 'PAYMENT.CAPTURE.COMPLETED',
        source: 'paypal',
        payload: { resource: { id: 'CAP-1', status: 'COMPLETED', amount: { value: '19.99', currency_code: 'USD' } } },
      },
    }));
    expect(events[0].subject).toBe('CAP-1');
    expect(events[0].amount).toBe(19.99);
    expect(events[0].currency).toBe('USD');
  });

  it('normalizes a GitHub event into the sink', async () => {
    const events: NormalizedWebhookEvent[] = [];
    const handler = createGithubHandler((event) => { events.push(event); });
    await handler(ctx({
      provider: 'github',
      eventType: 'push',
      delivery: {
        id: 'evt-3',
        type: 'push',
        source: 'github',
        payload: { repository: { full_name: 'acme/repo' }, sender: { login: 'octocat' }, action: 'opened' },
      },
    }));
    expect(events[0].subject).toBe('acme/repo');
    expect(events[0].status).toBe('opened');
  });

  it('tolerates malformed payloads without throwing', async () => {
    const handler = createStripeHandler(() => {});
    await expect(handler(ctx({ delivery: { id: 'x', type: 'charge.succeeded', source: 'stripe', payload: {} } }))).resolves.toBeUndefined();
  });

  it('declares the expected built-in event types', () => {
    expect(BUILTIN_EVENT_TYPES.stripe).toContain('invoice.paid');
    expect(BUILTIN_EVENT_TYPES.paypal).toContain('PAYMENT.CAPTURE.COMPLETED');
    expect(BUILTIN_EVENT_TYPES.github).toContain('pull_request');
  });

  it('builds a default registry with all built-in routes', () => {
    const events: NormalizedWebhookEvent[] = [];
    const registry = createDefaultRouteRegistry((event) => { events.push(event); });
    const match = registry.match('stripe', 'charge.succeeded');
    expect(registry.size()).toBe(10);
    expect(match?.route.name).toBe('stripe:charge.succeeded');
  });
});

// ?? Observability ???????????????????????????????????????????????????????

describe('observability hooks', () => {
  it('emits metrics for registration, match, miss and removal', () => {
    const tool = makeHooks();
    const registry = createRouteRegistry(
      { routes: [{ provider: 'stripe', eventType: 'invoice.paid', handler: () => {} }] },
      tool.hooks,
      tool.hooks
    );
    registry.match('stripe', 'invoice.paid');
    registry.match('stripe', 'unknown.event');
    registry.unregister('stripe', 'invoice.paid');
    const names = tool.metrics.map((m) => m.name);
    expect(names).toContain('webhook.route.registered');
    expect(names).toContain('webhook.route.matched');
    expect(names).toContain('webhook.route.missed');
    expect(names).toContain('webhook.route.unregistered');
    expect(tool.logs.some((l) => l.level === 'info')).toBe(true);
  });

  it('emits a duplicate metric and warning on rejection', () => {
    const tool = makeHooks();
    const registry = createRouteRegistry({}, tool.hooks, tool.hooks);
    const route: WebhookRoute = { provider: 'stripe', eventType: 'invoice.paid', handler: () => {} };
    registry.register(route);
    expect(() => registry.register(route)).toThrow(HandlerError);
    expect(tool.metrics.some((m) => m.name === 'webhook.route.duplicate')).toBe(true);
    expect(tool.logs.some((l) => l.level === 'warn')).toBe(true);
  });
});

// ?? Dispatcher integration ???????????????????????????????????????????????

describe('declarative dispatcher integration', () => {
  it('routes a valid delivery through a provider route', async () => {
    const events: NormalizedWebhookEvent[] = [];
    const seen: ProviderHandlerContext[] = [];
    const dispatcher = createDeclarativeDispatcher(
      POLICY,
      createProviderRoutes((event) => { events.push(event); })
    );
    dispatcher.registerHandler('charge.succeeded', (context) => { seen.push(context as unknown as ProviderHandlerContext); });
    const result = await dispatcher.dispatch(token(), delivery());
    expect(result.dispatched).toBe(true);
    expect(result.handler).toBe('stripe:charge.succeeded');
    expect(events).toHaveLength(1);
    expect(seen).toHaveLength(0);
  });

  it('passes provider and matched route metadata to a custom handler', async () => {
    let seen: ProviderHandlerContext | undefined;
    const dispatcher = createWebhookDispatcher({
      policy: POLICY,
      handlers: {},
      routes: [{ provider: 'stripe', eventType: 'charge.succeeded', handler: (context) => { seen = context; } }],
    });
    const result = await dispatcher.dispatch(token(), delivery());
    expect(result.dispatched).toBe(true);
    expect(seen?.provider).toBe('stripe');
    expect(seen?.eventType).toBe('charge.succeeded');
    expect(seen?.matchedRoute?.route.key).toBe('stripe::charge.succeeded');
    expect(seen?.matchedAudience).toBe('webhook-prod');
  });

  it('falls back to the legacy handler map when no route matches', async () => {
    let called = false;
    const dispatcher = createWebhookDispatcher({
      policy: POLICY,
      handlers: { 'charge.succeeded': () => { called = true; } },
      routes: [{ provider: 'paypal', eventType: 'charge.succeeded', handler: () => {} }],
    });
    const result = await dispatcher.dispatch(token(), delivery());
    expect(result.dispatched).toBe(true);
    expect(result.handler).toBe('charge.succeeded');
    expect(called).toBe(true);
  });

  it('exposes the configured registry on the dispatcher', () => {
    const dispatcher = createWebhookDispatcher({
      policy: POLICY,
      handlers: {},
      routes: createProviderRoutes(),
    });
    expect(dispatcher.routeRegistry?.size()).toBe(10);
    expect(() => dispatcher.registerRoute({ provider: 'custom', eventType: 'x', handler: () => {} })).not.toThrow();
    expect(dispatcher.routeRegistry?.size()).toBe(11);
  });

  it('still rejects deliveries whose JWT claims fail', async () => {
    const dispatcher = createDeclarativeDispatcher(POLICY, createProviderRoutes());
    const badToken = `${enc({ alg: 'HS256' })}.${enc({ aud: 'wrong', origin: 'https://billing.example.com', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
    const result = await dispatcher.dispatch(badToken, delivery());
    expect(result.dispatched).toBe(false);
    expect(result.error?.code).toBe('JWT_REJECTED');
  });
});
