/**
 * backend/src/webhooks/providers/types.ts
 *
 * Shared, dependency-free type surface for declarative webhook provider
 * routing (issue #2254). This module deliberately contains no I/O and no
 * imports so it can be consumed by the registry, the matchers, the built-in
 * provider handlers and the webhook dispatcher without creating cycles.
 *
 * Design rules:
 *  - Zero dependencies; every side effect is injected by the caller.
 *  - Every failure is a typed `HandlerError` with a stable `code`.
 *  - Route tables are plain data: a provider, an optional event type and a
 *    handler. Matching policy lives in `matching.ts`, not in callers.
 */

/** Token used as `eventType` on a route to match every event of a provider. */
export const WILDCARD_EVENT = '*';

/** Providers with first-class handler examples shipped with this module. */
export type ProviderKind = 'stripe' | 'paypal' | 'github';

/**
 * A provider name. Known providers are enumerated for editor support while
 * custom providers remain valid (a branded `string` keeps autocomplete).
 */
export type WebhookProvider = ProviderKind | (string & {});

/** Stable error codes emitted by the routing layer. */
export type HandlerErrorCode =
  | 'UNKNOWN_PROVIDER'
  | 'PROVIDER_NOT_ALLOWED'
  | 'INVALID_ROUTE'
  | 'INVALID_CONTEXT'
  | 'DUPLICATE_ROUTE'
  | 'NO_ROUTE'
  | 'HANDLER_FAILED';

/** Typed error for every routing failure. */
export class HandlerError extends Error {
  readonly code: HandlerErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: HandlerErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'HandlerError';
    this.code = code;
    this.details = details;
  }
}

/** Minimal delivery shape the routing layer needs; duck-typed on purpose. */
export interface WebhookDeliveryLike {
  readonly id: string;
  readonly type: string;
  readonly source: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Immutable descriptor of a compiled route, exposed to handlers. */
export interface RouteDescriptor {
  readonly provider: WebhookProvider;
  /** '*' denotes a wildcard route. */
  readonly eventType: string;
  /** Stable `provider::eventType` key. */
  readonly key: string;
  readonly name?: string;
  readonly description?: string;
  readonly priority: number;
}

/** Context passed to every provider handler. */
export interface ProviderHandlerContext {
  readonly provider: WebhookProvider;
  readonly eventType: string;
  readonly delivery: WebhookDeliveryLike;
  readonly claims?: Readonly<Record<string, unknown>>;
  readonly matchedAudience?: string;
  readonly normalizedOrigin?: string;
  readonly matchedRoute?: RouteDescriptor;
}

/** A provider handler may be synchronous or asynchronous. */
export interface ProviderHandler {
  (context: ProviderHandlerContext): void | Promise<void>;
}

/** Declarative route declaration consumed by `createRouteRegistry`. */
export interface WebhookRoute {
  readonly provider: WebhookProvider;
  /** Omitted or '*' means "any event for this provider". */
  readonly eventType?: string;
  readonly handler: ProviderHandler;
  /** Optional stable name used in logs, metrics and dispatch results. */
  readonly name?: string;
  readonly description?: string;
  /** Higher priority wins when two routes are equally specific. Default 0. */
  readonly priority?: number;
}

/** A validated, normalized, frozen route stored in a registry. */
export interface RegisteredRoute extends WebhookRoute {
  readonly provider: WebhookProvider;
  readonly eventType: string;
  readonly key: string;
  readonly priority: number;
}

/** Result of a successful route match. */
export interface RouteMatch {
  readonly route: RegisteredRoute;
  readonly provider: WebhookProvider;
  readonly eventType: string;
  /** True when the match came from a wildcard route. */
  readonly wildcard: boolean;
}

/** Counter-style metrics hook, structurally compatible with the JWT hooks. */
export interface RouteMetrics {
  increment(name: string, labels?: Readonly<Record<string, string>>): void;
}

/** Audit logger hook, structurally compatible with the JWT hooks. */
export interface RouteLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
}

/** Behaviour when a route key is registered twice. Default 'error'. */
export type DuplicatePolicy = 'error' | 'replace' | 'keepFirst';

/** Immutable registry configuration. */
export interface RouteRegistryConfig {
  readonly onDuplicate?: DuplicatePolicy;
  /** When set, only these providers may be registered. */
  readonly allowedProviders?: readonly WebhookProvider[];
  /** Optional seed routes; they are compiled and frozen on construction. */
  readonly routes?: readonly WebhookRoute[];
}

/** Public route registry surface. */
export interface RouteRegistry {
  readonly config: Readonly<RouteRegistryConfig>;
  register(route: WebhookRoute): RegisteredRoute;
  /** Remove an exact route, or every route for a provider when eventType is omitted. */
  unregister(provider: WebhookProvider, eventType?: string): boolean;
  match(provider: WebhookProvider, eventType: string): RouteMatch | undefined;
  /** True only when an exact route key exists (wildcards are not expanded). */
  has(provider: WebhookProvider, eventType?: string): boolean;
  handlers(): readonly RegisteredRoute[];
  providers(): readonly WebhookProvider[];
  size(): number;
  clear(): void;
}

/** Provider-agnostic event emitted by the built-in handler examples. */
export interface NormalizedWebhookEvent {
  readonly provider: WebhookProvider;
  readonly eventType: string;
  readonly deliveryId: string;
  readonly subject?: string;
  readonly status?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly occurredAt?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

/** Sink for normalized events; injected so the handlers stay pure. */
export type EventSink = (event: NormalizedWebhookEvent) => void | Promise<void>;
