/**
 * backend/src/webhooks/dispatcher.ts
 *
 * Webhook dispatcher that gates every inbound webhook on validated JWT
 * origin + audience claims (issue #2274). A delivery is only routed to a
 * handler after the JWT envelope passes policy validation; the JOSE
 * signature check remains the caller's responsibility and is represented
 * by the injected `verifySignature` hook.
 *
 * Design rules:
 *  - Pure routing logic, no I/O. All side effects go through injected hooks.
 *  - Every decision (accept/reject) emits metrics and an audit log entry.
 *  - Typed `DispatchError` codes for stable observability and tests.
 */

import {
  compilePolicy,
  createWebhookJwtValidator,
  WebhookJwtError,
  type WebhookJwtPolicy,
  type WebhookJwtValidationResult,
  type JwtValidationLogger,
  type JwtValidationMetrics,
} from './jwt.ts';
import {
  createRouteRegistry,
  type RouteMatch,
  type RouteRegistry,
  type RouteRegistryConfig,
  type WebhookProvider,
  type WebhookRoute,
} from './providers/index.ts';

// ?? Types ???????????????????????????????????????????????????????????????

export type DispatchErrorCode =
  | 'JWT_REJECTED'
  | 'SIGNATURE_INVALID'
  | 'NO_HANDLER'
  | 'HANDLER_FAILED'
  | 'INVALID_DELIVERY'
  | 'INVALID_CONFIG';

export class DispatchError extends Error {
  readonly code: DispatchErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DispatchErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'DispatchError';
    this.code = code;
    this.details = details;
  }
}

export interface WebhookDelivery {
  /** Stable event id, used for idempotency + audit correlation. */
  id: string;
  /** Event type, e.g. `invoice.paid`. */
  type: string;
  /** Emitting source system, for observability. */
  source: string;
  /** Arbitrary event payload. */
  payload: Readonly<Record<string, unknown>>;
}

export interface HandlerContext {
  delivery: WebhookDelivery;
  claims: WebhookJwtValidationResult['claims'];
  matchedAudience?: string;
  normalizedOrigin?: string;
  /** Provider that emitted the delivery (from `delivery.source`), when routed. */
  provider?: WebhookProvider;
  /** Declarative route that matched this delivery, when routed. */
  matchedRoute?: RouteMatch;
}

export type WebhookHandler = (context: HandlerContext) => void | Promise<void>;

export interface DispatcherHooks {
  metrics?: JwtValidationMetrics;
  logger?: JwtValidationLogger;
  /**
   * Verify the cryptographic signature over `signingInput`. Return true to
   * accept. Injected so this module stays dependency-free and testable.
   */
  verifySignature?: (signingInput: string, signature: string) => boolean | Promise<boolean>;
  /** Parse the token into signing input + signature for the JOSE layer. */
  splitToken?: (token: string) => { signingInput: string; signature: string };
}

export interface DispatchResult {
  dispatched: boolean;
  eventId?: string;
  handler?: string;
  error?: DispatchError;
}

export interface DispatcherConfig {
  policy: WebhookJwtPolicy;
  /** Legacy event-type handler map, used when no provider route matches. */
  handlers: Readonly<Record<string, WebhookHandler>>;
  hooks?: DispatcherHooks;
  /** Reject deliveries with no matching handler. Default true. */
  strictHandler?: boolean;
  /** Declarative provider routes; compiled into a registry when provided. */
  routes?: readonly WebhookRoute[];
  /** A pre-built route registry (takes precedence over `routes`). */
  routeRegistry?: RouteRegistry;
  /** Duplicate policy / allow-list forwarded to `createRouteRegistry`. */
  routeConfig?: RouteRegistryConfig;
}

// ?? Dispatcher factory ???????????????????????????????????????????????????

/** Validate the shape of a delivery object. */
export function validateDelivery(delivery: WebhookDelivery): void {
  if (!delivery || typeof delivery !== 'object') {
    throw new DispatchError('INVALID_DELIVERY', 'Delivery must be an object');
  }
  if (typeof delivery.id !== 'string' || delivery.id === '') {
    throw new DispatchError('INVALID_DELIVERY', 'Delivery.id must be a non-empty string');
  }
  if (typeof delivery.type !== 'string' || delivery.type === '') {
    throw new DispatchError('INVALID_DELIVERY', 'Delivery.type must be a non-empty string');
  }
  if (typeof delivery.source !== 'string' || delivery.source === '') {
    throw new DispatchError('INVALID_DELIVERY', 'Delivery.source must be a non-empty string');
  }
  if (delivery.payload === null || typeof delivery.payload !== 'object') {
    throw new DispatchError('INVALID_DELIVERY', 'Delivery.payload must be an object');
  }
}

/** Split a compact token without a full parse (for the signature hook). */
export function defaultSplitToken(token: string): { signingInput: string; signature: string } {
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new DispatchError('JWT_REJECTED', 'Token is not a compact JWS');
  }
  return { signingInput: `${parts[0]}.${parts[1]}`, signature: parts[2] };
}

/**
 * Create a dispatcher bound to a JWT policy and a handler map.
 */
export function createWebhookDispatcher(config: DispatcherConfig) {
  const compiled = compilePolicy(config.policy);
  const validator = createWebhookJwtValidator(compiled, {
    metrics: config.hooks?.metrics,
    logger: config.hooks?.logger,
  });
  const handlers: Readonly<Record<string, WebhookHandler>> = { ...(config.handlers ?? {}) };
  const strictHandler = config.strictHandler ?? true;
  const registry: RouteRegistry | undefined =
    config.routeRegistry ??
    (config.routes
      ? createRouteRegistry(
          { ...(config.routeConfig ?? {}), routes: config.routes },
          config.hooks?.metrics,
          config.hooks?.logger
        )
      : undefined);

  async function dispatch(token: string, delivery: WebhookDelivery): Promise<DispatchResult> {
    const metrics = config.hooks?.metrics;
    const logger = config.hooks?.logger;
    try {
      validateDelivery(delivery);

      // 1. Claims gate (audience + origin).
      const jwt = validator.validate(token);
      if (!jwt.valid) {
        const err = new DispatchError('JWT_REJECTED', 'Webhook JWT claim validation failed', {
          code: jwt.error?.code,
          eventId: delivery.id,
        });
        metrics?.increment('webhook.dispatch.rejected', { reason: 'jwt', code: jwt.error?.code ?? '' });
        logger?.warn('Webhook rejected: JWT claims invalid', { eventId: delivery.id, code: jwt.error?.code });
        return { dispatched: false, error: err };
      }

      // 2. Signature gate (delegated).
      if (config.hooks?.verifySignature) {
        const parts = (config.hooks.splitToken ?? defaultSplitToken)(token);
        const ok = await config.hooks.verifySignature(parts.signingInput, parts.signature);
        if (!ok) {
          const err = new DispatchError('SIGNATURE_INVALID', 'Webhook JWT signature is invalid', {
            eventId: delivery.id,
          });
          metrics?.increment('webhook.dispatch.rejected', { reason: 'signature' });
          logger?.warn('Webhook rejected: signature invalid', { eventId: delivery.id });
          return { dispatched: false, error: err };
        }
      }

      // 3. Declarative provider routing, then legacy event-type fallback.
      const matchedRoute = registry?.match(delivery.source, delivery.type);
      const routedHandler = matchedRoute?.route.handler as unknown as WebhookHandler | undefined;
      const handler = routedHandler ?? handlers[delivery.type];
      const handlerName = matchedRoute
        ? matchedRoute.route.name ?? `${matchedRoute.provider}:${matchedRoute.route.eventType}`
        : delivery.type;
      if (!handler) {
        if (!strictHandler) {
          metrics?.increment('webhook.dispatch.skipped', { type: delivery.type });
          logger?.info('Webhook skipped: no handler', { eventId: delivery.id, type: delivery.type });
          return { dispatched: false, eventId: delivery.id };
        }
        const err = new DispatchError('NO_HANDLER', `No handler registered for ${delivery.type}`, {
          eventId: delivery.id,
        });
        metrics?.increment('webhook.dispatch.rejected', { reason: 'no_handler' });
        logger?.warn('Webhook rejected: no handler', { eventId: delivery.id, type: delivery.type });
        return { dispatched: false, error: err };
      }

      // 4. Invoke handler with the original JWT context plus routing metadata.
      const handlerContext: HandlerContext & { eventType: string } = {
        delivery,
        claims: jwt.claims,
        matchedAudience: jwt.matchedAudience,
        normalizedOrigin: jwt.normalizedOrigin,
        provider: delivery.source,
        matchedRoute,
        eventType: delivery.type,
      };
      await handler(handlerContext);
      metrics?.increment('webhook.dispatch.accepted', {
        type: delivery.type,
        provider: delivery.source,
        handler: handlerName,
      });
      logger?.info('Webhook dispatched', {
        eventId: delivery.id,
        type: delivery.type,
        provider: delivery.source,
        handler: handlerName,
      });
      return { dispatched: true, eventId: delivery.id, handler: handlerName };
    } catch (err) {
      if (err instanceof DispatchError) {
        return { dispatched: false, error: err };
      }
      if (err instanceof WebhookJwtError) {
        return { dispatched: false, error: new DispatchError('JWT_REJECTED', err.message, { code: err.code }) };
      }
      const wrapped = new DispatchError('HANDLER_FAILED', 'Webhook handler threw an error', {
        eventId: delivery.id,
        message: err instanceof Error ? err.message : String(err),
      });
      metrics?.increment('webhook.dispatch.failed', { type: delivery.type });
      logger?.warn('Webhook handler failed', { eventId: delivery.id });
      return { dispatched: false, error: wrapped };
    }
  }

  return {
    dispatch,
    registerHandler(type: string, handler: WebhookHandler): void {
      (handlers as Record<string, WebhookHandler>)[type] = handler;
    },
    handlerTypes(): string[] {
      return Object.keys(handlers);
    },
    /** Register a provider route at runtime when a registry is configured. */
    registerRoute(route: WebhookRoute): void {
      if (!registry) throw new DispatchError('INVALID_CONFIG', 'No route registry configured');
      registry.register(route);
    },
    /** The configured declarative registry, if any. */
    routeRegistry: registry,
    policy: compiled,
  };
}

/** Convenience one-shot dispatch. */
export function dispatchWebhook(
  token: string,
  delivery: WebhookDelivery,
  config: DispatcherConfig
): Promise<DispatchResult> {
  return createWebhookDispatcher(config).dispatch(token, delivery);
}

/**
 * Build a dispatcher whose handler surface is entirely declarative: the JWT
 * gate still runs, but routing is driven by the supplied provider routes.
 */
export function createDeclarativeDispatcher(
  policy: WebhookJwtPolicy,
  routes: readonly WebhookRoute[],
  hooks?: DispatcherHooks,
  routeConfig?: RouteRegistryConfig
) {
  return createWebhookDispatcher({ policy, handlers: {}, routes, hooks, routeConfig });
}
