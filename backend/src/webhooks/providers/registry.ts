/**
 * backend/src/webhooks/providers/registry.ts
 *
 * Declarative route registry for inbound webhooks. Routes are plain data
 * declarations; the registry validates, freezes and matches them while
 * emitting metrics and audit-log hooks on every state change and match.
 *
 * Design rules:
 *  - Zero dependencies and no I/O; observability is injected.
 *  - Configuration and all returned values are frozen.
 *  - Duplicate keys follow an explicit, configurable policy.
 *  - The JWT gate in `dispatcher.ts` remains authoritative; this registry
 *    only decides which provider handler receives an already-valid delivery.
 */

import {
  HandlerError,
  type WebhookProvider,
  type WebhookRoute,
  type RegisteredRoute,
  type RouteMatch,
  type RouteRegistry,
  type RouteRegistryConfig,
  type RouteMetrics,
  type RouteLogger,
} from './types.ts';
import {
  compileRoute,
  matchRoute,
  normalizeProvider,
  routeKey,
} from './matching.ts';

/**
 * Create an immutable-config route registry with observability hooks.
 *
 * @param config Optional duplicate policy, provider allow-list and seed routes.
 * @param metrics Optional counter hook (`increment`).
 * @param logger Optional audit hook (`info` / `warn`).
 */
export function createRouteRegistry(
  config: RouteRegistryConfig = {},
  metrics?: RouteMetrics,
  logger?: RouteLogger
): RouteRegistry {
  const onDuplicate = config.onDuplicate ?? 'error';
  if (onDuplicate !== 'error' && onDuplicate !== 'replace' && onDuplicate !== 'keepFirst') {
    throw new HandlerError('INVALID_CONTEXT', `Unknown onDuplicate policy: ${String(onDuplicate)}`);
  }

  const allowedProviders: readonly string[] | undefined = config.allowedProviders
    ? Object.freeze(config.allowedProviders.map((provider) => normalizeProvider(provider)))
    : undefined;

  // Mutable seed input is intentionally not retained; only the policy is frozen.
  const frozenConfig: Readonly<RouteRegistryConfig> = Object.freeze({
    onDuplicate,
    ...(allowedProviders ? { allowedProviders: allowedProviders as readonly WebhookProvider[] } : {}),
  });

  const routes = new Map<string, RegisteredRoute>();

  function assertProviderAllowed(provider: string): void {
    if (allowedProviders && !allowedProviders.includes(provider)) {
      throw new HandlerError('PROVIDER_NOT_ALLOWED', `Provider ${provider} is not in the allow-list`, {
        provider,
        allowedProviders,
      });
    }
  }

  function register(route: WebhookRoute): RegisteredRoute {
    const compiled = compileRoute(route);
    assertProviderAllowed(compiled.provider);
    const existing = routes.get(compiled.key);
    if (existing) {
      if (onDuplicate === 'error') {
        metrics?.increment('webhook.route.duplicate', {
          provider: compiled.provider,
          eventType: compiled.eventType,
        });
        logger?.warn('Webhook route duplicate rejected', { key: compiled.key });
        throw new HandlerError('DUPLICATE_ROUTE', `A route already exists for ${compiled.key}`, {
          key: compiled.key,
        });
      }
      if (onDuplicate === 'keepFirst') return existing;
      // 'replace': fall through and overwrite the key in place.
    }
    routes.set(compiled.key, compiled);
    metrics?.increment('webhook.route.registered', {
      provider: compiled.provider,
      eventType: compiled.eventType,
      replacement: existing ? 'true' : 'false',
    });
    logger?.info('Webhook route registered', {
      key: compiled.key,
      provider: compiled.provider,
      eventType: compiled.eventType,
    });
    return routes.get(compiled.key) as RegisteredRoute;
  }

  if (config.routes !== undefined) {
    if (!Array.isArray(config.routes)) {
      throw new HandlerError('INVALID_ROUTE', 'config.routes must be an array');
    }
    for (const route of config.routes) register(route);
  }

  function match(provider: WebhookProvider, eventType: string): RouteMatch | undefined {
    const normalizedProvider = normalizeProvider(provider);
    if (typeof eventType !== 'string' || eventType.trim() === '') {
      metrics?.increment('webhook.route.missed', { provider: normalizedProvider, eventType: '' });
      return undefined;
    }
    const normalizedEventType = eventType.trim();
    const found = matchRoute(Array.from(routes.values()), normalizedProvider, normalizedEventType);
    if (found) {
      metrics?.increment('webhook.route.matched', {
        provider: found.provider,
        eventType: found.eventType,
        wildcard: found.wildcard ? 'true' : 'false',
      });
      logger?.info('Webhook route matched', {
        key: found.route.key,
        provider: found.provider,
        eventType: found.eventType,
      });
    } else {
      metrics?.increment('webhook.route.missed', {
        provider: normalizedProvider,
        eventType: normalizedEventType,
      });
    }
    return found;
  }

  function has(provider: WebhookProvider, eventType?: string): boolean {
    const normalizedProvider = normalizeProvider(provider);
    if (eventType === undefined) {
      const prefix = `${normalizedProvider}::`;
      return Array.from(routes.keys()).some((key) => key.startsWith(prefix));
    }
    return routes.has(routeKey(normalizedProvider, eventType));
  }

  function unregister(provider: WebhookProvider, eventType?: string): boolean {
    const normalizedProvider = normalizeProvider(provider);
    let removed = 0;
    if (eventType === undefined) {
      const prefix = `${normalizedProvider}::`;
      for (const key of Array.from(routes.keys())) {
        if (key.startsWith(prefix) && routes.delete(key)) removed += 1;
      }
    } else if (routes.delete(routeKey(normalizedProvider, eventType))) {
      removed += 1;
    }
    if (removed > 0) {
      metrics?.increment('webhook.route.unregistered', {
        provider: normalizedProvider,
        count: String(removed),
      });
      logger?.info('Webhook route unregistered', { provider: normalizedProvider, count: removed });
    }
    return removed > 0;
  }

  return {
    config: frozenConfig,
    register,
    unregister,
    match,
    has,
    handlers(): readonly RegisteredRoute[] {
      return Object.freeze(Array.from(routes.values()));
    },
    providers(): readonly WebhookProvider[] {
      const names = Array.from(routes.values()).map((route) => route.provider);
      return Object.freeze(Array.from(new Set(names)));
    },
    size(): number {
      return routes.size;
    },
    clear(): void {
      const count = routes.size;
      routes.clear();
      if (count > 0) {
        metrics?.increment('webhook.route.cleared', { count: String(count) });
        logger?.info('Webhook route registry cleared', { count });
      }
    },
  };
}

/**
 * Convenience helper: register an array of declarative routes at once on an
 * existing registry. Returns the number of newly stored routes.
 */
export function registerRoutes(
  registry: RouteRegistry,
  routes: readonly WebhookRoute[]
): number {
  if (!Array.isArray(routes)) {
    throw new HandlerError('INVALID_ROUTE', 'routes must be an array');
  }
  const before = registry.size();
  for (const route of routes) registry.register(route);
  return registry.size() - before;
}
