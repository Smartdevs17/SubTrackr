/**
 * backend/src/webhooks/providers/index.ts
 *
 * Declarative webhook provider routing (issue #2254). This module exposes a
 * typed route table, a frozen route registry, pure route matching, built-in
 * Stripe / PayPal / GitHub handlers and observability hooks.
 *
 * It is intentionally dependency-free and side-effect-free: the JWT-gated
 * dispatcher in `../dispatcher.ts` decides *whether* a delivery is trusted,
 * while this layer decides *which provider handler* receives it.
 *
 * Usage:
 *   const registry = createRouteRegistry({ routes: createProviderRoutes(sink) }, metrics, logger);
 *   const match = registry.match('stripe', 'invoice.paid');
 *   await match?.route.handler({ provider: 'stripe', eventType: 'invoice.paid', delivery, ... });
 */

export * from './types.ts';
export * from './matching.ts';
export * from './registry.ts';
export * from './handlers.ts';

import { createRouteRegistry } from './registry.ts';
import { createProviderRoutes } from './handlers.ts';
import type {
  EventSink,
  RouteLogger,
  RouteMetrics,
  RouteRegistry,
  RouteRegistryConfig,
} from './types.ts';

/** Frozen default route table covering all built-in providers. */
export const DEFAULT_PROVIDER_ROUTES = createProviderRoutes();

/**
 * Build a registry preloaded with the built-in provider routes.
 *
 * @param sink Optional sink receiving normalized events from built-in handlers.
 * @param config Optional duplicate policy / provider allow-list overrides.
 * @param metrics Optional counter hook.
 * @param logger Optional audit hook.
 */
export function createDefaultRouteRegistry(
  sink?: EventSink,
  config: RouteRegistryConfig = {},
  metrics?: RouteMetrics,
  logger?: RouteLogger
): RouteRegistry {
  return createRouteRegistry(
    { ...config, routes: createProviderRoutes(sink) },
    metrics,
    logger
  );
}
