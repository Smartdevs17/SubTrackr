/**
 * Typed Domain Event Bus - SubTrackr
 *
 * Features:
 *  - Fully typed event definitions per domain (subscription, billing, analytics, auth, contract)
 *  - Runtime schema validation (no external deps)
 *  - In-process pub/sub with wildcard + predicate filter subscriptions
 *  - Event sourcing: append-only store with sequence, replay, state reconstruction
 *  - Performance monitoring: publish latency, handler timing, throughput counters
 *  - Testing utilities: spy bus, event collector, assertion helpers
 */

// ---------------------------------------------------------------------------
// Base Event Shape
// ---------------------------------------------------------------------------

export interface DomainEvent<
  TDomain extends string = string,
  TType extends string = string,
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly id: string;
  readonly domain: TDomain;
  readonly type: TType;
  /** Fully-qualified name used for subscriptions: "domain.type" */
  readonly name: `${TDomain}.${TType}`;
  readonly payload: TPayload;
  readonly occurredAt: number;
  /** Monotonically increasing per aggregate */
  readonly sequence: number;
  readonly schemaVersion: number;
  readonly correlationId?: string;
  readonly aggregateId?: string;
}

// ---------------------------------------------------------------------------
// Payload interfaces extend Record<string, unknown> so they satisfy the
// DomainEvent<..., TPayload extends Record<string, unknown>> constraint.
// ---------------------------------------------------------------------------

// -- Subscription domain -----------------------------------------------------

export interface SubscriptionCreatedPayload extends Record<string, unknown> {
  subscriptionId: string;
  userId: string;
  planId: string;
  status: string;
  billingCycle: string;
  nextBillingDate: number;
}

export interface SubscriptionCancelledPayload extends Record<string, unknown> {
  subscriptionId: string;
  userId: string;
  reason?: string;
  cancelledAt: number;
  effectiveAt: number;
}

export interface SubscriptionRenewedPayload extends Record<string, unknown> {
  subscriptionId: string;
  userId: string;
  planId: string;
  renewedAt: number;
  nextBillingDate: number;
  amount: number;
  currency: string;
}

export interface SubscriptionUpgradedPayload extends Record<string, unknown> {
  subscriptionId: string;
  userId: string;
  fromPlanId: string;
  toPlanId: string;
  effectiveAt: number;
  proratedCredit?: number;
}

export interface SubscriptionPausedPayload extends Record<string, unknown> {
  subscriptionId: string;
  userId: string;
  pausedAt: number;
  resumeAt?: number;
}

export interface SubscriptionResumedPayload extends Record<string, unknown> {
  subscriptionId: string;
  userId: string;
  resumedAt: number;
}

export interface SubscriptionPaymentFailedPayload extends Record<string, unknown> {
  subscriptionId: string;
  userId: string;
  attemptNumber: number;
  nextRetryAt?: number;
  reason: string;
}

export type SubscriptionEvent =
  | DomainEvent<'subscription', 'created', SubscriptionCreatedPayload>
  | DomainEvent<'subscription', 'cancelled', SubscriptionCancelledPayload>
  | DomainEvent<'subscription', 'renewed', SubscriptionRenewedPayload>
  | DomainEvent<'subscription', 'upgraded', SubscriptionUpgradedPayload>
  | DomainEvent<'subscription', 'paused', SubscriptionPausedPayload>
  | DomainEvent<'subscription', 'resumed', SubscriptionResumedPayload>
  | DomainEvent<'subscription', 'payment_failed', SubscriptionPaymentFailedPayload>;

// -- Billing domain ----------------------------------------------------------

export interface InvoiceGeneratedPayload extends Record<string, unknown> {
  invoiceId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  dueDate: number;
}

export interface PaymentCapturedPayload extends Record<string, unknown> {
  paymentId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  capturedAt: number;
  gateway: string;
}

export interface UsageThresholdReachedPayload extends Record<string, unknown> {
  subscriptionId: string;
  userId: string;
  metricType: string;
  usage: number;
  limit: number;
  ratio: number;
  level: 'soft' | 'hard';
}

export interface ChargebackRaisedPayload extends Record<string, unknown> {
  chargebackId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  reason: string;
  raisedAt: number;
}

export type BillingEvent =
  | DomainEvent<'billing', 'invoice_generated', InvoiceGeneratedPayload>
  | DomainEvent<'billing', 'payment_captured', PaymentCapturedPayload>
  | DomainEvent<'billing', 'usage_threshold_reached', UsageThresholdReachedPayload>
  | DomainEvent<'billing', 'chargeback_raised', ChargebackRaisedPayload>;

// -- Analytics domain --------------------------------------------------------

export interface ChurnRiskUpdatedPayload extends Record<string, unknown> {
  subscriptionId: string;
  userId: string;
  riskScore: number;
  previousScore?: number;
  factors: string[];
}

export interface CohortAggregatedPayload extends Record<string, unknown> {
  cohortId: string;
  period: string;
  retentionRate: number;
  size: number;
}

export interface MrrChangedPayload extends Record<string, unknown> {
  previousMrr: number;
  currentMrr: number;
  delta: number;
  currency: string;
  periodStart: number;
  periodEnd: number;
}

export type AnalyticsEvent =
  | DomainEvent<'analytics', 'churn_risk_updated', ChurnRiskUpdatedPayload>
  | DomainEvent<'analytics', 'cohort_aggregated', CohortAggregatedPayload>
  | DomainEvent<'analytics', 'mrr_changed', MrrChangedPayload>;

// -- Auth domain -------------------------------------------------------------

export interface ApiKeyRotatedPayload extends Record<string, unknown> {
  keyId: string;
  merchantId: string;
  rotatedAt: number;
  expiresAt?: number;
}

export interface SsoSessionCreatedPayload extends Record<string, unknown> {
  sessionId: string;
  userId: string;
  provider: string;
  createdAt: number;
  expiresAt: number;
}

export type AuthEvent =
  | DomainEvent<'auth', 'api_key_rotated', ApiKeyRotatedPayload>
  | DomainEvent<'auth', 'sso_session_created', SsoSessionCreatedPayload>;

// -- Contract domain (Soroban) -----------------------------------------------

export interface ContractInvokedPayload extends Record<string, unknown> {
  contractId: string;
  method: string;
  caller: string;
  ledger: number;
  txHash: string;
}

export interface ContractUpgradedPayload extends Record<string, unknown> {
  proxyId: string;
  fromImplementation: string;
  toImplementation: string;
  upgradedAt: number;
  ledger: number;
}

export type ContractEvent =
  | DomainEvent<'contract', 'invoked', ContractInvokedPayload>
  | DomainEvent<'contract', 'upgraded', ContractUpgradedPayload>;

// -- Union -------------------------------------------------------------------

export type AnyDomainEvent =
  | SubscriptionEvent
  | BillingEvent
  | AnalyticsEvent
  | AuthEvent
  | ContractEvent;

/** Extract the payload type for a specific event name */
export type EventPayload<TName extends AnyDomainEvent['name']> = Extract<
  AnyDomainEvent,
  { name: TName }
>['payload'];

// ---------------------------------------------------------------------------
// Schema Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

type SchemaField = {
  required?: boolean;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
};
type Schema = Record<string, SchemaField>;

const PAYLOAD_SCHEMAS: Partial<Record<AnyDomainEvent['name'], Schema>> = {
  'subscription.created': {
    subscriptionId: { required: true, type: 'string' },
    userId: { required: true, type: 'string' },
    planId: { required: true, type: 'string' },
    status: { required: true, type: 'string' },
    billingCycle: { required: true, type: 'string' },
    nextBillingDate: { required: true, type: 'number' },
  },
  'subscription.cancelled': {
    subscriptionId: { required: true, type: 'string' },
    userId: { required: true, type: 'string' },
    cancelledAt: { required: true, type: 'number' },
    effectiveAt: { required: true, type: 'number' },
  },
  'subscription.renewed': {
    subscriptionId: { required: true, type: 'string' },
    userId: { required: true, type: 'string' },
    planId: { required: true, type: 'string' },
    renewedAt: { required: true, type: 'number' },
    nextBillingDate: { required: true, type: 'number' },
    amount: { required: true, type: 'number' },
    currency: { required: true, type: 'string' },
  },
  'billing.invoice_generated': {
    invoiceId: { required: true, type: 'string' },
    subscriptionId: { required: true, type: 'string' },
    userId: { required: true, type: 'string' },
    amount: { required: true, type: 'number' },
    currency: { required: true, type: 'string' },
    dueDate: { required: true, type: 'number' },
  },
  'billing.payment_captured': {
    paymentId: { required: true, type: 'string' },
    subscriptionId: { required: true, type: 'string' },
    userId: { required: true, type: 'string' },
    amount: { required: true, type: 'number' },
    currency: { required: true, type: 'string' },
    capturedAt: { required: true, type: 'number' },
    gateway: { required: true, type: 'string' },
  },
  'billing.usage_threshold_reached': {
    subscriptionId: { required: true, type: 'string' },
    userId: { required: true, type: 'string' },
    metricType: { required: true, type: 'string' },
    usage: { required: true, type: 'number' },
    limit: { required: true, type: 'number' },
    ratio: { required: true, type: 'number' },
    level: { required: true, type: 'string' },
  },
};

export function validateEventPayload(
  eventName: AnyDomainEvent['name'],
  payload: Record<string, unknown>,
): ValidationResult {
  const schema = PAYLOAD_SCHEMAS[eventName];
  if (!schema) return { valid: true, errors: [] };

  const errors: string[] = [];
  for (const [field, rule] of Object.entries(schema)) {
    const value = payload[field];
    if (rule.required && (value === undefined || value === null)) {
      errors.push(`Missing required field: ${field}`);
      continue;
    }
    if (value !== undefined && value !== null) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== rule.type) {
        errors.push(`Field "${field}" expected ${rule.type}, got ${actualType}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Event Sourcing Store
// ---------------------------------------------------------------------------

export interface EventStoreQuery {
  aggregateId?: string;
  domain?: AnyDomainEvent['domain'];
  type?: string;
  from?: number;
  to?: number;
  limit?: number;
  includeArchived?: boolean;
}

export interface AggregateSnapshot {
  aggregateId: string;
  state: Record<string, unknown>;
  lastSequence: number;
  lastEventType: string;
  updatedAt: number;
}

export interface EventSourcedStore {
  append(event: AnyDomainEvent): void;
  query(filter?: EventStoreQuery): AnyDomainEvent[];
  replay(aggregateId: string, handler: (event: AnyDomainEvent) => void): void;
  reconstruct(aggregateId: string): Record<string, unknown>;
  snapshot(aggregateId: string): AggregateSnapshot;
  archiveBefore(timestamp: number): number;
}

interface StoredRecord {
  event: AnyDomainEvent;
  archivedAt?: number;
}

export class InMemoryEventStore implements EventSourcedStore {
  private readonly records: StoredRecord[] = [];
  private readonly sequences = new Map<string, number>();

  append(event: AnyDomainEvent): void {
    this.records.push({ event });
    if (event.aggregateId) {
      this.sequences.set(
        event.aggregateId,
        Math.max(this.sequences.get(event.aggregateId) ?? 0, event.sequence),
      );
    }
  }

  query(filter: EventStoreQuery = {}): AnyDomainEvent[] {
    return this.records
      .filter(({ event, archivedAt }) => {
        if (!filter.includeArchived && archivedAt) return false;
        if (filter.aggregateId && event.aggregateId !== filter.aggregateId) return false;
        if (filter.domain && event.domain !== filter.domain) return false;
        if (filter.type && event.type !== filter.type) return false;
        if (filter.from && event.occurredAt < filter.from) return false;
        if (filter.to && event.occurredAt > filter.to) return false;
        return true;
      })
      .map(({ event }) => event)
      .slice(0, filter.limit ?? Number.MAX_SAFE_INTEGER);
  }

  replay(aggregateId: string, handler: (event: AnyDomainEvent) => void): void {
    this.query({ aggregateId, includeArchived: true })
      .sort((a, b) => a.sequence - b.sequence)
      .forEach(handler);
  }

  reconstruct(aggregateId: string): Record<string, unknown> {
    return this.query({ aggregateId, includeArchived: true })
      .sort((a, b) => a.sequence - b.sequence)
      .reduce<Record<string, unknown>>(
        (state, event) => ({
          ...state,
          ...(event.payload as Record<string, unknown>),
          id: aggregateId,
          lastEventType: event.name,
          updatedAt: event.occurredAt,
        }),
        { id: aggregateId },
      );
  }

  snapshot(aggregateId: string): AggregateSnapshot {
    const events = this.query({ aggregateId, includeArchived: true }).sort(
      (a, b) => a.sequence - b.sequence,
    );
    const last = events[events.length - 1];
    return {
      aggregateId,
      state: this.reconstruct(aggregateId),
      lastSequence: last?.sequence ?? 0,
      lastEventType: last?.name ?? '',
      updatedAt: last?.occurredAt ?? 0,
    };
  }

  archiveBefore(timestamp: number): number {
    let count = 0;
    for (const record of this.records) {
      if (!record.archivedAt && record.event.occurredAt < timestamp) {
        record.archivedAt = Date.now();
        count++;
      }
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// Event Bus
// ---------------------------------------------------------------------------

export type EventHandler<T extends AnyDomainEvent = AnyDomainEvent> = (
  event: T,
) => void | Promise<void>;

export type EventFilter<T extends AnyDomainEvent = AnyDomainEvent> = (event: T) => boolean;

export interface SubscriptionOptions<T extends AnyDomainEvent = AnyDomainEvent> {
  filter?: EventFilter<T>;
}

export interface EventSubscription {
  readonly id: string;
  unsubscribe(): void;
}

export interface EventBusMetrics {
  published: number;
  handled: number;
  errors: number;
  avgHandlerLatencyMs: number;
  countByName: Record<string, number>;
  throughputPerSecond: number;
}

export interface IEventBus {
  publish<T extends AnyDomainEvent>(event: T): Promise<void>;
  subscribe<T extends AnyDomainEvent>(
    name: T['name'] | '*',
    handler: EventHandler<T>,
    options?: SubscriptionOptions<T>,
  ): EventSubscription;
  getMetrics(): EventBusMetrics;
  resetMetrics(): void;
}

export class EventValidationError extends Error {
  constructor(
    public readonly eventName: string,
    public readonly validationErrors: string[],
  ) {
    super(`Event "${eventName}" failed validation: ${validationErrors.join('; ')}`);
    this.name = 'EventValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface RegisteredHandler {
  id: string;
  name: string;
  handler: EventHandler<AnyDomainEvent>;
  filter?: EventFilter<AnyDomainEvent>;
}

export class EventBus implements IEventBus {
  private readonly handlers: RegisteredHandler[] = [];
  private nextId = 1;

  private published = 0;
  private handled = 0;
  private errors = 0;
  private handlerLatencies: number[] = [];
  private recentTimestamps: number[] = [];
  private readonly countByName: Record<string, number> = {};

  async publish<T extends AnyDomainEvent>(event: T): Promise<void> {
    const result = validateEventPayload(
      event.name as AnyDomainEvent['name'],
      event.payload as Record<string, unknown>,
    );
    if (!result.valid) {
      throw new EventValidationError(event.name, result.errors);
    }

    this.published++;
    this.countByName[event.name] = (this.countByName[event.name] ?? 0) + 1;
    this.recentTimestamps.push(Date.now());

    const matching = this.handlers.filter((h) => h.name === '*' || h.name === event.name);
    for (const h of matching) {
      if (h.filter && !h.filter(event)) continue;
      const start = Date.now();
      try {
        await h.handler(event);
        this.handled++;
      } catch {
        this.errors++;
      } finally {
        this.handlerLatencies.push(Date.now() - start);
        if (this.handlerLatencies.length > 10_000) this.handlerLatencies.shift();
      }
    }
  }

  subscribe<T extends AnyDomainEvent>(
    name: T['name'] | '*',
    handler: EventHandler<T>,
    options?: SubscriptionOptions<T>,
  ): EventSubscription {
    const id = `esub_${this.nextId++}`;
    this.handlers.push({
      id,
      name,
      handler: handler as EventHandler<AnyDomainEvent>,
      filter: options?.filter as EventFilter<AnyDomainEvent> | undefined,
    });
    return {
      id,
      unsubscribe: () => {
        const idx = this.handlers.findIndex((h) => h.id === id);
        if (idx !== -1) this.handlers.splice(idx, 1);
      },
    };
  }

  getMetrics(): EventBusMetrics {
    const cutoff = Date.now() - 60_000;
    this.recentTimestamps = this.recentTimestamps.filter((t) => t >= cutoff);
    const avg =
      this.handlerLatencies.length === 0
        ? 0
        : this.handlerLatencies.reduce((a, b) => a + b, 0) / this.handlerLatencies.length;
    return {
      published: this.published,
      handled: this.handled,
      errors: this.errors,
      avgHandlerLatencyMs: Math.round(avg * 100) / 100,
      countByName: { ...this.countByName },
      throughputPerSecond: Math.round((this.recentTimestamps.length / 60) * 100) / 100,
    };
  }

  resetMetrics(): void {
    this.published = 0;
    this.handled = 0;
    this.errors = 0;
    this.handlerLatencies = [];
    this.recentTimestamps = [];
    for (const key of Object.keys(this.countByName)) delete this.countByName[key];
  }
}

// ---------------------------------------------------------------------------
// Event Builder
// ---------------------------------------------------------------------------

let _globalSequence = 0;

/**
 * Constructs a fully-typed domain event ready for publishing.
 *
 * @example
 * const event = buildEvent('subscription', 'created', payload, { aggregateId: sub.id });
 * await eventBus.publish(event);
 */
export function buildEvent<
  TDomain extends AnyDomainEvent['domain'],
  TType extends string,
  TPayload extends Record<string, unknown>,
>(
  domain: TDomain,
  type: TType,
  payload: TPayload,
  opts: {
    aggregateId?: string;
    correlationId?: string;
    schemaVersion?: number;
    occurredAt?: number;
  } = {},
): DomainEvent<TDomain, TType, TPayload> {
  const seq = ++_globalSequence;
  return {
    id: `evt_${Date.now().toString(36)}_${seq}`,
    domain,
    type,
    name: `${domain}.${type}` as `${TDomain}.${TType}`,
    payload,
    occurredAt: opts.occurredAt ?? Date.now(),
    sequence: seq,
    schemaVersion: opts.schemaVersion ?? 1,
    correlationId: opts.correlationId,
    aggregateId: opts.aggregateId,
  };
}

// ---------------------------------------------------------------------------
// Testing Utilities
// ---------------------------------------------------------------------------

/** Collects published events for assertions in tests. */
export class EventCollector {
  private readonly collected: AnyDomainEvent[] = [];
  private readonly sub: EventSubscription;

  constructor(bus: IEventBus, name: AnyDomainEvent['name'] | '*' = '*') {
    this.sub = bus.subscribe(name, (event) => {
      this.collected.push(event);
    });
  }

  all(): AnyDomainEvent[] {
    return [...this.collected];
  }

  ofName<T extends AnyDomainEvent>(name: T['name']): T[] {
    return this.collected.filter((e) => e.name === name) as T[];
  }

  assertCount(expected: number): void {
    if (this.collected.length !== expected) {
      throw new Error(
        `EventCollector: expected ${expected} events, got ${this.collected.length}`,
      );
    }
  }

  assertLastEventName(name: AnyDomainEvent['name']): void {
    const last = this.collected[this.collected.length - 1];
    if (!last || last.name !== name) {
      throw new Error(
        `EventCollector: expected last event "${name}", got "${last?.name ?? 'none'}"`,
      );
    }
  }

  clear(): void {
    this.collected.length = 0;
  }

  dispose(): void {
    this.sub.unsubscribe();
  }
}

/**
 * SpyEventBus wraps a real EventBus and records every publish call.
 * Drop-in replacement for tests that need to inspect emitted events.
 */
export class SpyEventBus implements IEventBus {
  private readonly inner = new EventBus();
  readonly published: AnyDomainEvent[] = [];

  async publish<T extends AnyDomainEvent>(event: T): Promise<void> {
    this.published.push(event);
    await this.inner.publish(event);
  }

  subscribe<T extends AnyDomainEvent>(
    name: T['name'] | '*',
    handler: EventHandler<T>,
    options?: SubscriptionOptions<T>,
  ): EventSubscription {
    return this.inner.subscribe(name, handler, options);
  }

  getMetrics(): EventBusMetrics {
    return this.inner.getMetrics();
  }

  resetMetrics(): void {
    this.published.length = 0;
    this.inner.resetMetrics();
  }

  assertPublished(name: AnyDomainEvent['name']): void {
    if (!this.published.some((e) => e.name === name)) {
      const names = this.published.map((e) => e.name).join(', ');
      throw new Error(
        `SpyEventBus: expected "${name}" to be published. Got: [${names}]`,
      );
    }
  }

  assertEmpty(): void {
    if (this.published.length > 0) {
      throw new Error(
        `SpyEventBus: expected no events, but got ${this.published.length}: [${this.published.map((e) => e.name).join(', ')}]`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Prometheus Metrics Export
// ---------------------------------------------------------------------------

export function eventBusPrometheusMetrics(
  bus: IEventBus,
  namespace = 'subtrackr_event_bus',
): string {
  const m = bus.getMetrics();
  const lines = [
    `# HELP ${namespace}_published_total Total events published`,
    `# TYPE ${namespace}_published_total counter`,
    `${namespace}_published_total ${m.published}`,
    `# HELP ${namespace}_handled_total Total handler invocations`,
    `# TYPE ${namespace}_handled_total counter`,
    `${namespace}_handled_total ${m.handled}`,
    `# HELP ${namespace}_errors_total Total handler errors`,
    `# TYPE ${namespace}_errors_total counter`,
    `${namespace}_errors_total ${m.errors}`,
    `# HELP ${namespace}_avg_handler_latency_ms Average handler latency`,
    `# TYPE ${namespace}_avg_handler_latency_ms gauge`,
    `${namespace}_avg_handler_latency_ms ${m.avgHandlerLatencyMs}`,
    `# HELP ${namespace}_throughput_per_second Events per second (last 60s)`,
    `# TYPE ${namespace}_throughput_per_second gauge`,
    `${namespace}_throughput_per_second ${m.throughputPerSecond}`,
  ];
  for (const [name, count] of Object.entries(m.countByName)) {
    lines.push(`${namespace}_by_name_total{event="${name}"} ${count}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

export const eventBus = new EventBus();
export const eventStore = new InMemoryEventStore();