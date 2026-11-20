/**
 * backend/src/gateways/billingAdapter.ts
 *
 * Issue #2039 — Extract provider adapters behind a single BillingAdapter interface.
 *
 * Every billing provider used to be called directly from its own module, which
 * meant charge/refund call sites had to know each provider's URL layout, status
 * vocabulary and error shape. This module defines ONE `BillingAdapter`
 * contract and a small protocol layer that translates each provider into it.
 *
 * Design notes:
 *   - All money is integer minor units. Floats never cross this boundary.
 *   - Every mutating call requires a caller-owned idempotency key. The key is
 *     forwarded to the provider through the transport so retries are safe.
 *   - Provider-specific quirks live in `BillingProtocol` implementations only.
 *     Nothing above this layer imports Stripe / PayPal / Paddle types.
 *   - Every call emits a `BillingTelemetryEvent` (duration + outcome + error
 *     code), so billing failures are observable without changing call sites.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type BillingProvider = 'stripe' | 'paypal' | 'paddle';

export type BillingOperation = 'charge' | 'refund' | 'fetch';

export interface BillingMoney {
  /** Integer minor units (cents, paise, …). Never a float. */
  amountMinor: number;
  /** ISO-4217 three-letter currency code, upper case. */
  currency: string;
}

export interface BillingChargeRequest {
  /** Stable, caller-owned key. Reuse it when retrying the same logical charge. */
  idempotencyKey: string;
  amount: BillingMoney;
  customerId: string;
  description?: string;
}

export interface BillingRefundRequest {
  /** Stable, caller-owned key. One refund per key. */
  idempotencyKey: string;
  /** The `providerChargeId` returned by `charge()`. */
  providerChargeId: string;
  amount?: BillingMoney;
  reason?: string;
}

export interface BillingChargeResult {
  ok: true;
  operation: 'charge';
  provider: BillingProvider;
  providerChargeId: string;
  status: 'succeeded' | 'pending' | 'requires_action';
  amount: BillingMoney;
  createdAt: string;
}

export interface BillingRefundResult {
  ok: true;
  operation: 'refund';
  provider: BillingProvider;
  providerRefundId: string;
  providerChargeId: string;
  status: 'succeeded' | 'pending';
  amount: BillingMoney;
  createdAt: string;
}

export type BillingResult = BillingChargeResult | BillingRefundResult;

export type BillingErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_OPERATION'
  | 'UNKNOWN';

export class BillingAdapterError extends Error {
  constructor(
    public readonly code: BillingErrorCode,
    public readonly provider: BillingProvider,
    message: string,
    public readonly retryable = false,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BillingAdapterError';
  }
}

/** Narrow HTTP surface an adapter needs. Inject any HTTP client here. */
export interface BillingTransport {
  request(request: BillingTransportRequest): Promise<BillingTransportResponse>;
}

export interface BillingTransportRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface BillingTransportResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface BillingTelemetryEvent {
  operation: BillingOperation;
  provider: BillingProvider;
  outcome: 'success' | 'failure';
  durationMs: number;
  errorCode?: BillingErrorCode;
  providerChargeId?: string;
}

export interface BillingTelemetry {
  record(event: BillingTelemetryEvent): void;
}

export const noopBillingTelemetry: BillingTelemetry = {
  record: () => undefined,
};

/** Structured, sink-agnostic telemetry factory for services that log to console. */
export function createConsoleBillingTelemetry(
  logger: Pick<Console, 'warn' | 'error'> = console,
): BillingTelemetry {
  return {
    record(event) {
      if (event.outcome === 'success') return;
      logger.error('[billing] operation failed', {
        operation: event.operation,
        provider: event.provider,
        errorCode: event.errorCode,
        durationMs: event.durationMs,
      });
    },
  };
}

export interface BillingAdapterOptions {
  transport: BillingTransport;
  telemetry?: BillingTelemetry;
  now?: () => number;
}

/** The single contract every billing provider implements. */
export interface BillingAdapter {
  readonly provider: BillingProvider;
  charge(request: BillingChargeRequest): Promise<BillingChargeResult>;
  refund(request: BillingRefundRequest): Promise<BillingRefundResult>;
  fetchCharge(providerChargeId: string): Promise<BillingChargeResult>;
}

// ── Provider protocol layer ───────────────────────────────────────────────────

interface ProviderErrorInfo {
  code: BillingErrorCode;
  message: string;
  retryable: boolean;
}

interface BillingProtocol {
  provider: BillingProvider;
  chargePath(request: BillingChargeRequest): string;
  refundPath(request: BillingRefundRequest): string;
  fetchPath(providerChargeId: string): string;
  buildChargeBody(request: BillingChargeRequest): Record<string, unknown>;
  buildRefundBody(request: BillingRefundRequest): Record<string, unknown>;
  parseCharge(body: Record<string, unknown>, request: BillingChargeRequest): BillingChargeResult;
  parseRefund(body: Record<string, unknown>, request: BillingRefundRequest): BillingRefundResult;
  /** Extract the amount from a fetch response (provider shapes differ). */
  extractAmount(body: Record<string, unknown>): BillingMoney;
  classifyError(status: number, body: Record<string, unknown>): ProviderErrorInfo;
}

function readString(body: Record<string, unknown>, key: string, provider: BillingProvider): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BillingAdapterError(
      'INVALID_RESPONSE',
      provider,
      `Provider response is missing a usable "${key}" value`,
    );
  }
  return value;
}

function readNestedString(
  body: Record<string, unknown>,
  path: string[],
  provider: BillingProvider,
): string {
  let current: unknown = body;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) break;
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== 'string' || current.length === 0) {
    throw new BillingAdapterError(
      'INVALID_RESPONSE',
      provider,
      `Provider response is missing a usable "${path.join('.')}" value`,
    );
  }
  return current;
}

function readNumber(body: Record<string, unknown>, key: string, provider: BillingProvider): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BillingAdapterError(
      'INVALID_RESPONSE',
      provider,
      `Provider response is missing a numeric "${key}" value`,
    );
  }
  return value;
}

function classifyHttpError(
  provider: BillingProvider,
  status: number,
  message: string,
): ProviderErrorInfo {
  if (status === 429) {
    return { code: 'RATE_LIMITED', message, retryable: true };
  }
  if (status >= 500) {
    return { code: 'PROVIDER_UNAVAILABLE', message, retryable: true };
  }
  if (status === 401 || status === 403 || status === 400 || status === 422) {
    return { code: 'PROVIDER_REJECTED', message, retryable: false };
  }
  if (status === 404) {
    return { code: 'UNKNOWN', message, retryable: false };
  }
  return { code: 'UNKNOWN', message, retryable: status >= 500 };
}

function providerMessage(body: Record<string, unknown>): string {
  const error = body.error;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  const message = body.message;
  return typeof message === 'string' ? message : 'Billing provider rejected the request';
}

// ── Stripe ────────────────────────────────────────────────────────────────────

const stripeProtocol: BillingProtocol = {
  provider: 'stripe',
  chargePath: () => '/v1/payment_intents',
  refundPath: () => '/v1/refunds',
  fetchPath: (id) => `/v1/payment_intents/${encodeURIComponent(id)}`,
  buildChargeBody: (request) => ({
    amount: request.amount.amountMinor,
    currency: request.amount.currency.toLowerCase(),
    customer: request.customerId,
    description: request.description,
  }),
  buildRefundBody: (request) => ({
    payment_intent: request.providerChargeId,
    amount: request.amount?.amountMinor,
    reason: request.reason,
  }),
  parseCharge(body, request) {
    const status = readString(body, 'status', 'stripe');
    return {
      ok: true,
      operation: 'charge',
      provider: 'stripe',
      providerChargeId: readString(body, 'id', 'stripe'),
      status:
        status === 'succeeded'
          ? 'succeeded'
          : status === 'requires_action'
            ? 'requires_action'
            : 'pending',
      amount: request.amount,
      createdAt: new Date(readNumber(body, 'created', 'stripe') * 1000).toISOString(),
    };
  },
  parseRefund(body, request) {
    const status = readString(body, 'status', 'stripe');
    return {
      ok: true,
      operation: 'refund',
      provider: 'stripe',
      providerRefundId: readString(body, 'id', 'stripe'),
      providerChargeId: request.providerChargeId,
      status: status === 'succeeded' ? 'succeeded' : 'pending',
      amount: request.amount ?? { amountMinor: 0, currency: '' },
      createdAt: new Date(readNumber(body, 'created', 'stripe') * 1000).toISOString(),
    };
  },
  extractAmount(body) {
    return { amountMinor: readNumber(body, 'amount', 'stripe'), currency: readString(body, 'currency', 'stripe').toUpperCase() };
  },
  classifyError: (status, body) =>
    classifyHttpError('stripe', status, providerMessage(body)),
};

// ── PayPal ────────────────────────────────────────────────────────────────────

const paypalProtocol: BillingProtocol = {
  provider: 'paypal',
  chargePath: () => '/v2/checkout/orders',
  refundPath: (request) => `/v2/payments/captures/${encodeURIComponent(request.providerChargeId)}/refund`,
  fetchPath: (id) => `/v2/checkout/orders/${encodeURIComponent(id)}`,
  buildChargeBody: (request) => ({
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: {
          value: (request.amount.amountMinor / 100).toFixed(2),
          currency_code: request.amount.currency.toUpperCase(),
        },
        description: request.description,
      },
    ],
  }),
  buildRefundBody: (request) => ({
    amount: request.amount
      ? {
          value: (request.amount.amountMinor / 100).toFixed(2),
          currency_code: request.amount.currency.toUpperCase(),
        }
      : undefined,
    note_to_payer: request.reason,
  }),
  parseCharge(body, request) {
    const status = readString(body, 'status', 'paypal');
    return {
      ok: true,
      operation: 'charge',
      provider: 'paypal',
      providerChargeId: readString(body, 'id', 'paypal'),
      status: status === 'COMPLETED' ? 'succeeded' : status === 'APPROVED' ? 'requires_action' : 'pending',
      amount: request.amount,
      createdAt: readNestedString(body, ['create_time'], 'paypal'),
    };
  },
  parseRefund(body, request) {
    return {
      ok: true,
      operation: 'refund',
      provider: 'paypal',
      providerRefundId: readString(body, 'id', 'paypal'),
      providerChargeId: request.providerChargeId,
      status: readString(body, 'status', 'paypal').toLowerCase() === 'completed' ? 'succeeded' : 'pending',
      amount: request.amount ?? { amountMinor: 0, currency: '' },
      createdAt: readNestedString(body, ['create_time'], 'paypal'),
    };
  },
  extractAmount(body) {
    const units = body.purchase_units as Array<Record<string, unknown>> | undefined;
    const amount = (units?.[0]?.amount ?? body.amount ?? {}) as Record<string, unknown>;
    const value = amount.value;
    if (typeof value !== 'string' || Number.isNaN(Number(value))) {
      throw new BillingAdapterError(
        'INVALID_RESPONSE',
        'paypal',
        'Provider response is missing a numeric "amount.value" value',
      );
    }
    return {
      amountMinor: Math.round(Number(value) * 100),
      currency: readString(amount, 'currency_code', 'paypal').toUpperCase(),
    };
  },
  classifyError: (status, body) =>
    classifyHttpError('paypal', status, providerMessage(body)),
};

// ── Paddle ────────────────────────────────────────────────────────────────────

const paddleProtocol: BillingProtocol = {
  provider: 'paddle',
  chargePath: () => '/transactions',
  refundPath: () => '/refunds',
  fetchPath: (id) => `/transactions/${encodeURIComponent(id)}`,
  buildChargeBody: (request) => ({
    amount: request.amount.amountMinor,
    currency: request.amount.currency.toUpperCase(),
    customer_id: request.customerId,
    description: request.description,
  }),
  buildRefundBody: (request) => ({
    transaction_id: request.providerChargeId,
    amount: request.amount?.amountMinor,
    reason: request.reason,
  }),
  parseCharge(body, request) {
    const data = (body.data ?? body) as Record<string, unknown>;
    const status = readString(data, 'status', 'paddle');
    return {
      ok: true,
      operation: 'charge',
      provider: 'paddle',
      providerChargeId: readString(data, 'id', 'paddle'),
      status: status === 'completed' || status === 'succeeded' ? 'succeeded' : 'pending',
      amount: request.amount,
      createdAt: readString(data, 'created_at', 'paddle'),
    };
  },
  parseRefund(body, request) {
    const data = (body.data ?? body) as Record<string, unknown>;
    return {
      ok: true,
      operation: 'refund',
      provider: 'paddle',
      providerRefundId: readString(data, 'id', 'paddle'),
      providerChargeId: request.providerChargeId,
      status: readString(data, 'status', 'paddle').toLowerCase() === 'succeeded' ? 'succeeded' : 'pending',
      amount: request.amount ?? { amountMinor: 0, currency: '' },
      createdAt: readString(data, 'created_at', 'paddle'),
    };
  },
  extractAmount(body) {
    const data = (body.data ?? body) as Record<string, unknown>;
    return {
      amountMinor: readNumber(data, 'amount', 'paddle'),
      currency: readString(data, 'currency', 'paddle').toUpperCase(),
    };
  },
  classifyError: (status, body) =>
    classifyHttpError('paddle', status, providerMessage(body)),
};

// ── Generic adapter ───────────────────────────────────────────────────────────

class HttpBillingAdapter implements BillingAdapter {
  readonly provider: BillingProvider;
  private readonly transport: BillingTransport;
  private readonly telemetry: BillingTelemetry;
  private readonly now: () => number;

  constructor(
    private readonly protocol: BillingProtocol,
    options: BillingAdapterOptions,
  ) {
    this.provider = protocol.provider;
    this.transport = options.transport;
    this.telemetry = options.telemetry ?? noopBillingTelemetry;
    this.now = options.now ?? (() => Date.now());
  }

  async charge(request: BillingChargeRequest): Promise<BillingChargeResult> {
    this.validateMoney(request.amount);
    this.validateIdempotencyKey(request.idempotencyKey);
    if (!request.customerId) {
      throw new BillingAdapterError('INVALID_REQUEST', this.provider, 'customerId is required');
    }

    const started = this.now();
    try {
      const response = await this.send({
        method: 'POST',
        path: this.protocol.chargePath(request),
        body: this.protocol.buildChargeBody(request),
        idempotencyKey: request.idempotencyKey,
      });
      const result = this.protocol.parseCharge(response.body, request);
      this.telemetry.record({
        operation: 'charge',
        provider: this.provider,
        outcome: 'success',
        durationMs: this.now() - started,
        providerChargeId: result.providerChargeId,
      });
      return result;
    } catch (error) {
      this.emitFailure('charge', started, error);
      throw error;
    }
  }

  async refund(request: BillingRefundRequest): Promise<BillingRefundResult> {
    this.validateIdempotencyKey(request.idempotencyKey);
    if (!request.providerChargeId) {
      throw new BillingAdapterError(
        'INVALID_REQUEST',
        this.provider,
        'providerChargeId is required',
      );
    }
    if (request.amount) this.validateMoney(request.amount);

    const started = this.now();
    try {
      const response = await this.send({
        method: 'POST',
        path: this.protocol.refundPath(request),
        body: this.protocol.buildRefundBody(request),
        idempotencyKey: request.idempotencyKey,
      });
      const result = this.protocol.parseRefund(response.body, request);
      this.telemetry.record({
        operation: 'refund',
        provider: this.provider,
        outcome: 'success',
        durationMs: this.now() - started,
        providerChargeId: result.providerChargeId,
      });
      return result;
    } catch (error) {
      this.emitFailure('refund', started, error);
      throw error;
    }
  }

  async fetchCharge(providerChargeId: string): Promise<BillingChargeResult> {
    if (!providerChargeId) {
      throw new BillingAdapterError(
        'INVALID_REQUEST',
        this.provider,
        'providerChargeId is required',
      );
    }

    const started = this.now();
    try {
      const response = await this.send({
        method: 'GET',
        path: this.protocol.fetchPath(providerChargeId),
      });
      const body = response.body;
      const result = this.protocol.parseCharge(body, {
        idempotencyKey: 'read-only',
        customerId: '',
        amount: this.protocol.extractAmount(body),
      });
      this.telemetry.record({
        operation: 'fetch',
        provider: this.provider,
        outcome: 'success',
        durationMs: this.now() - started,
        providerChargeId: result.providerChargeId,
      });
      return result;
    } catch (error) {
      this.emitFailure('fetch', started, error);
      throw error;
    }
  }

  private async send(request: BillingTransportRequest): Promise<BillingTransportResponse> {
    let response: BillingTransportResponse;
    try {
      response = await this.transport.request(request);
    } catch (error) {
      throw new BillingAdapterError(
        'PROVIDER_UNAVAILABLE',
        this.provider,
        'Billing provider transport failed',
        true,
        error,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      const info = this.protocol.classifyError(response.status, response.body ?? {});
      throw new BillingAdapterError(
        info.code,
        this.provider,
        info.message,
        info.retryable,
        response,
      );
    }
    return response;
  }

  private validateMoney(amount: BillingMoney): void {
    if (!Number.isSafeInteger(amount.amountMinor) || amount.amountMinor <= 0) {
      throw new BillingAdapterError(
        'INVALID_REQUEST',
        this.provider,
        'amountMinor must be a positive integer',
      );
    }
    if (!/^[A-Z]{3}$/.test(amount.currency)) {
      throw new BillingAdapterError(
        'INVALID_REQUEST',
        this.provider,
        'currency must be a three-letter upper-case ISO code',
      );
    }
  }

  private validateIdempotencyKey(key: string): void {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new BillingAdapterError(
        'INVALID_REQUEST',
        this.provider,
        'idempotencyKey is required',
      );
    }
  }

  private emitFailure(operation: BillingOperation, started: number, error: unknown): void {
    this.telemetry.record({
      operation,
      provider: this.provider,
      outcome: 'failure',
      durationMs: this.now() - started,
      errorCode: error instanceof BillingAdapterError ? error.code : 'UNKNOWN',
    });
  }
}

// ── Registry / factory ────────────────────────────────────────────────────────

const PROTOCOLS: Record<BillingProvider, BillingProtocol> = {
  stripe: stripeProtocol,
  paypal: paypalProtocol,
  paddle: paddleProtocol,
};

/**
 * Resolve a provider adapter. Unknown providers are rejected rather than
 * silently falling back, so a typo cannot route money to the wrong gateway.
 */
export function createBillingAdapter(
  provider: BillingProvider,
  options: BillingAdapterOptions,
): BillingAdapter {
  const protocol = PROTOCOLS[provider];
  if (!protocol) {
    throw new BillingAdapterError(
      'UNSUPPORTED_OPERATION',
      provider,
      `No billing adapter registered for provider "${provider}"`,
    );
  }
  return new HttpBillingAdapter(protocol, options);
}

/** All providers with a registered adapter — useful for health dashboards. */
export function listBillingAdapters(): BillingProvider[] {
  return Object.keys(PROTOCOLS) as BillingProvider[];
}
