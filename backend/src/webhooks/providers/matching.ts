/**
 * backend/src/webhooks/providers/matching.ts
 *
 * Pure route normalization and matching for declarative webhook routing.
 * No I/O, no clock reads, no observability side effects — those belong to the
 * registry in `registry.ts`.
 *
 * Matching rules:
 *  - Provider names are trimmed and lower-cased (so `Stripe` == `stripe`).
 *  - Event types are matched exactly, case-sensitively.
 *  - A route with no `eventType`, or with `'*'`, is a provider wildcard.
 *  - An exact route always beats a wildcard; ties break on `priority` and
 *    then on registration order (first registered wins).
 */

import {
  HandlerError,
  WILDCARD_EVENT,
  type WebhookProvider,
  type WebhookRoute,
  type RegisteredRoute,
  type RouteMatch,
} from './types.ts';

/** Normalize a provider name for comparison and keying. */
export function normalizeProvider(provider: WebhookProvider): string {
  if (typeof provider !== 'string' || provider.trim() === '') {
    throw new HandlerError('INVALID_CONTEXT', 'Provider must be a non-empty string');
  }
  return provider.trim().toLowerCase();
}

/** Normalize an event type; undefined/empty becomes the wildcard token. */
export function normalizeEventType(eventType: string | undefined): string {
  if (eventType === undefined || eventType === null) return WILDCARD_EVENT;
  if (typeof eventType !== 'string') {
    throw new HandlerError('INVALID_ROUTE', 'Event type must be a string');
  }
  const trimmed = eventType.trim();
  return trimmed === '' ? WILDCARD_EVENT : trimmed;
}

/** Build the canonical `provider::eventType` key for a route. */
export function routeKey(provider: WebhookProvider, eventType: string | undefined): string {
  const normalizedProvider = normalizeProvider(provider);
  return `${normalizedProvider}::${normalizeEventType(eventType)}`;
}

/**
 * Validate and compile a declarative route into a frozen, canonical form.
 * The handler reference is preserved; all other fields are normalized.
 */
export function compileRoute(route: WebhookRoute): RegisteredRoute {
  if (route === null || typeof route !== 'object') {
    throw new HandlerError('INVALID_ROUTE', 'Route must be an object');
  }
  if (typeof route.handler !== 'function') {
    throw new HandlerError('INVALID_ROUTE', 'Route.handler must be a function', {
      provider: route.provider,
      eventType: route.eventType,
    });
  }
  const provider = normalizeProvider(route.provider);
  const eventType = normalizeEventType(route.eventType);
  const priority = Number.isFinite(route.priority) ? Number(route.priority) : 0;
  return Object.freeze({
    ...route,
    provider,
    eventType,
    key: `${provider}::${eventType}`,
    priority,
  });
}

interface Candidate {
  readonly route: WebhookRoute;
  readonly exact: boolean;
  readonly priority: number;
  readonly index: number;
}

/** True when `a` should be preferred over `b` under the documented rules. */
function betterThan(a: Candidate, b: Candidate): boolean {
  if (a.exact !== b.exact) return a.exact;
  if (a.priority !== b.priority) return a.priority > b.priority;
  return a.index < b.index;
}

/**
 * Find the best route for a provider + event type in an ordered route list.
 * Returns `undefined` when no route matches; never invokes a handler.
 */
export function matchRoute(
  routes: readonly WebhookRoute[],
  provider: WebhookProvider,
  eventType: string
): RouteMatch | undefined {
  if (!Array.isArray(routes)) {
    throw new HandlerError('INVALID_CONTEXT', 'routes must be an array');
  }
  const normalizedProvider = normalizeProvider(provider);
  if (typeof eventType !== 'string' || eventType.trim() === '') {
    throw new HandlerError('INVALID_CONTEXT', 'eventType must be a non-empty string');
  }
  const normalizedEventType = eventType.trim();

  let best: Candidate | undefined;
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    if (route === null || typeof route !== 'object' || typeof route.handler !== 'function') {
      continue;
    }
    let routeProvider: string;
    try {
      routeProvider = normalizeProvider(route.provider);
    } catch {
      continue;
    }
    if (routeProvider !== normalizedProvider) continue;

    const routeEventType = normalizeEventType(route.eventType);
    const isWildcard = routeEventType === WILDCARD_EVENT;
    const isExact = routeEventType === normalizedEventType;
    if (!isWildcard && !isExact) continue;

    const candidate: Candidate = {
      route,
      exact: isExact,
      priority: Number.isFinite(route.priority) ? Number(route.priority) : 0,
      index,
    };
    if (best === undefined || betterThan(candidate, best)) best = candidate;
  }

  if (best === undefined) return undefined;

  return Object.freeze({
    route: compileRoute(best.route),
    provider: normalizedProvider,
    eventType: normalizedEventType,
    wildcard: !best.exact,
  });
}
