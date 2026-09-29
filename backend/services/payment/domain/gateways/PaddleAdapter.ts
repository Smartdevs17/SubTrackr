/**
 * Paddle Billing gateway (issue #1240).
 *
 * Paddle is a merchant-of-record: it takes the payment, charges the sales/VAT
 * and remits the tax, then settles the net balance to the merchant's bank
 * account. SubTrackr therefore talks to Paddle as a *billing* provider rather
 * than a raw card processor, and this adapter maps Paddle's Billing API onto
 * the same `IPaymentGateway` port as Stripe, Circle, Stellar and Shopify.
 *
 * Port mapping (Paddle Billing API v2):
 *
 * | Port method        | Paddle operation                          | Notes                                                       |
 * | ------------------ | ----------------------------------------- | ----------------------------------------------------------- |
 * | `charge`           | `POST /transactions`                      | needs `metadata.paddlePriceId`; carries the idempotency key   |
 * | `refund`           | `POST /transactions/{id}/refunds`         | amount is converted to minor units; not retried               |
 * | `createCustomer`   | `POST /customers`                         | —                                                             |
 * | `getPaymentMethod` | `GET /transactions/{id}`                  | Paddle exposes the card summary on the transaction, see below|
 * | `createPayout`     | —                                         | Paddle settles merchant funds itself; see below               |
 *
 * Three behaviours are deliberate:
 *
 * - **Amounts are converted to minor units.** Paddle's refund API takes the
 *   lowest currency unit (cents). Zero-decimal currencies (JPY, KRW, VND) are
 *   passed through unchanged rather than being multiplied by 100.
 * - **Retries follow the idempotency of the operation.** `charge` is retried on
 *   a transport failure, HTTP 429 or a 5xx because Paddle de-duplicates a
 *   repeated `Idempotency-Key`. `refund` and `createCustomer` are *not*
 *   retried: a repeated refund would refund the customer twice.
 * - **Failures are returned, not thrown, where the port has an error channel.**
 *   `charge` and `refund` return `status: 'failed'` with a machine-readable
 *   `errorMessage`, which is what lets `PaymentRouter` fall through to the next
 *   gateway. `createCustomer` and `getPaymentMethod` have no failure channel in
 *   `interfaces.ts`, so they raise `PaymentError.gatewayError` instead of
 *   returning a hollow success.
 *
 * Authentication is a Bearer token (`Authorization: Bearer <api_key>`), unlike
 * the other card gateways which use a signed request.
 *
 * Configuration (see `.env.example`):
 *
 * ```bash
 * PADDLE_API_KEY=pdl_live_apikey_…      # or pdl_sdbx_apikey_… in sandbox
 * PADDLE_ENVIRONMENT=sandbox            # sandbox | production
 * PADDLE_CLIENT_SIDE_TOKEN=pdl_nm_…     # optional, for Paddle.js checkout
 * ```
 *
 * `PaddleAdapter.fromEnvironment()` returns `null` while Paddle is unconfigured,
 * so the container never offers Paddle as a fallback on a deployment that has
 * no Paddle credentials.
 */

import { BasePaymentGateway } from './PaymentGateway';
import { PaymentError } from '../../errors';
import { createLoggerFor } from '../../../shared/logging';
import type {
  CustomerResult,
  PaymentMethodResult,
  PaymentRequest,
  PaymentResult,
  PayoutRequest,
  PayoutResult,
  RefundRequest,
  RefundResult,
} from '../../interfaces';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

const logger = createLoggerFor('payment.paddle');

const PADDLE_BASE_URLS = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
} as const;

/** Currencies Paddle bills in whole units, so no ×100 conversion applies. */
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XOF', 'XAF']);

export type PaddleEnvironment = keyof typeof PADDLE_BASE_URLS;

export interface PaddleFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface PaddleFetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

/** The slice of `fetch` this adapter needs. Injected in tests. */
export type PaddleFetch = (url: string, init: PaddleFetchInit) => Promise<PaddleFetchResponse>;

export interface PaddleAdapterOptions {
  /** Paddle API key. A `pdl_sdbx_…` key must be paired with `sandbox`. */
  readonly apiKey: string;
  /** Defaults to `sandbox`. */
  readonly environment?: PaddleEnvironment;
  /** Injected in tests. Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: PaddleFetch;
  /** Attempts per retryable request. Defaults to 3. */
  readonly maxAttempts?: number;
  /** Base delay between retryable attempts, in ms. Defaults to 250. */
  readonly retryBaseDelayMs?: number;
  /** Injected in tests, so a retry does not wait. Defaults to `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface PaddleTransaction {
  readonly id: string;
  readonly status: 'ready' | 'awaiting_action' | 'completed' | 'cancelled';
  readonly currency_code?: string;
  readonly collection_mode?: 'automatic' | 'manual';
  readonly payment_method_details?: {
    readonly type?: string | null;
    readonly card?: {
      readonly last4?: string | null;
      readonly expiry_month?: number | null;
      readonly expiry_year?: number | null;
      readonly brand?: string | null;
    } | null;
  } | null;
}

export interface PaddleRefund {
  readonly id: string;
  readonly status: 'pending' | 'completed';
  readonly amount?: number;
  readonly currency_code?: string;
}

export interface PaddleCustomer {
  readonly id: string;
  readonly email?: string;
  readonly name?: string;
}

type PaddleOutcome<T> =
  | { readonly status: 'ok'; readonly data: T }
  | { readonly status: 'error'; readonly code: string; readonly message: string };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJson(text: string): { data?: unknown; error?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as { data?: unknown; error?: unknown };
  } catch {
    return null;
  }
}

/** Paddle's structured error body, when it sends one. */
function paddleErrorMessage(parsed: { error?: unknown } | null, fallback: string): string {
  const error = parsed?.error as
    | { message?: unknown; code?: unknown }
    | undefined
    | null;
  const message = typeof error?.message === 'string' ? error.message : undefined;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  if (message && code) return `${code}: ${message}`;
  return message ?? fallback;
}

/** Convert a major-unit amount to the lowest unit Paddle expects. */
export function toPaddleMinorUnits(amount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.trim().toUpperCase())) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}

export class PaddleAdapter extends BasePaymentGateway {
  readonly name = 'paddle';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly injectedFetch: PaddleFetch | undefined;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: PaddleAdapterOptions) {
    super();

    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw PaymentError.gatewayError('paddle', 'apiKey is required');
    }
    const environment: PaddleEnvironment = options.environment ?? 'sandbox';
    if (!PADDLE_BASE_URLS[environment]) {
      throw PaymentError.gatewayError('paddle', `unknown environment: ${String(environment)}`);
    }

    this.apiKey = apiKey;
    this.baseUrl = PADDLE_BASE_URLS[environment];
    this.injectedFetch = options.fetchImpl;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Builds an adapter from the environment, or `null` when Paddle is not
   * configured. The container uses this so an unconfigured deployment never
   * lists Paddle as a fallback gateway.
   */
  static fromEnvironment(
    env: Record<string, string | undefined> = process.env,
  ): PaddleAdapter | null {
    const apiKey = env.PADDLE_API_KEY?.trim();
    if (!apiKey) {
      logger.info('Paddle gateway not configured; skipping registration');
      return null;
    }
    const environment = (env.PADDLE_ENVIRONMENT?.trim() || 'sandbox') as PaddleEnvironment;
    return new PaddleAdapter({
      apiKey,
      environment: PADDLE_BASE_URLS[environment] ? environment : 'sandbox',
    });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Opens a Paddle transaction for the catalog price behind the request. The
   * transaction is idempotent per `request.idempotencyKey`, so a retried charge
   * cannot bill the subscriber twice.
   */
  async charge(request: PaymentRequest): Promise<PaymentResult> {
    const priceId = request.metadata?.paddlePriceId?.trim();
    if (!priceId) {
      return this.failure(
        request,
        'paddle_price_missing: charge() requires metadata.paddlePriceId (Paddle bills catalog prices, not raw amounts)',
      );
    }

    const outcome = await this.call<{ data: PaddleTransaction }>(
      '/transactions',
      'POST',
      {
        data: {
          items: [{ price_id: priceId, quantity: 1 }],
          currency_code: request.currency.toUpperCase(),
          collection_mode: 'automatic',
          description: `SubTrackr charge ${request.idempotencyKey}`,
          custom_data: {
            subtrackr_customer_id: request.customerId,
            subtrackr_payment_method: request.paymentMethodId,
            subtrackr_idempotency_key: request.idempotencyKey,
          },
          ...(request.metadata?.paddleCustomerId
            ? { customer: { id: request.metadata.paddleCustomerId } }
            : {}),
        },
      },
      { idempotencyKey: request.idempotencyKey, retryable: true },
    );

    if (outcome.status === 'error') {
      logger.warn('Paddle charge failed', { code: outcome.code, priceId });
      return this.failure(request, `${outcome.code}: ${outcome.message}`);
    }

    const transaction = outcome.data?.data;
    if (!transaction?.id) {
      return this.failure(
        request,
        'paddle_empty_response: POST /transactions returned no transaction',
      );
    }

    // `awaiting_action` means Paddle accepted the transaction but the buyer
    // still has to authenticate (3-D Secure) in Paddle.js. That is a non-terminal
    // outcome, not a failure, so the router must not fall through to another gateway.
    if (transaction.status !== 'completed') {
      if (transaction.status === 'cancelled') {
        return this.failure(
          request,
          `paddle_transaction_cancelled: ${transaction.id}`,
        );
      }
      return {
        id: transaction.id,
        status: 'pending',
        amount: request.amount,
        currency: request.currency,
        gatewayUsed: this.name,
        chargeId: transaction.id,
        errorMessage: `paddle_transaction_${transaction.status}`,
        processedAt: new Date().toISOString(),
      };
    }

    return this.buildSuccessResult(
      transaction.id,
      request.amount,
      request.currency,
      transaction.id,
    );
  }

  /**
   * Refunds a Paddle transaction. Not retried: a second `POST /refunds` would
   * refund the customer twice. The amount is converted to Paddle's minor units.
   */
  async refund(request: RefundRequest): Promise<RefundResult> {
    const transactionId = request.metadata?.paddleTransactionId?.trim() || request.chargeId?.trim();
    const amount = request.amount ?? 0;

    if (!transactionId) {
      return this.refundFailure(
        request,
        'paddle_transaction_missing: refund() requires a Paddle transaction id',
      );
    }
    if (amount <= 0) {
      return this.refundFailure(request, 'paddle_amount_invalid: refund amount must be positive');
    }

    const currency = (request.metadata?.paddleCurrency ?? 'USD').toUpperCase();
    const outcome = await this.call<{ data: PaddleRefund }>(
      `/transactions/${encodeURIComponent(transactionId)}/refunds`,
      'POST',
      { data: { amount: toPaddleMinorUnits(amount, currency) } },
      { retryable: false },
    );

    if (outcome.status === 'error') {
      return this.refundFailure(request, `${outcome.code}: ${outcome.message}`);
    }

    const refund = outcome.data?.data;
    if (!refund?.id) {
      return this.refundFailure(
        request,
        'paddle_empty_response: refunds endpoint returned no refund',
      );
    }

    return {
      id: refund.id,
      chargeId: transactionId,
      status: refund.status === 'completed' ? 'succeeded' : 'pending',
      amount,
      gatewayUsed: this.name,
      processedAt: new Date().toISOString(),
    };
  }

  async createCustomer(email: string, name: string): Promise<CustomerResult> {
    const outcome = await this.call<{ data: PaddleCustomer }>(
      '/customers',
      'POST',
      { data: { email, name } },
      { retryable: false },
    );

    if (outcome.status === 'error') {
      throw PaymentError.gatewayError(this.name, `${outcome.code}: ${outcome.message}`);
    }

    const customer = outcome.data?.data;
    if (!customer?.id) {
      throw PaymentError.gatewayError(
        this.name,
        'paddle_empty_response: POST /customers returned no customer',
      );
    }

    logger.info('Paddle customer created', { customerId: customer.id });
    return { id: customer.id, gatewayCustomerId: customer.id, gatewayUsed: this.name };
  }

  /**
   * Paddle is a merchant of record: the card is tokenised by Paddle.js and the
   * only summary it exposes is on the transaction (`payment_method_details`).
   * There is no standalone stored-payment-method endpoint, so a `pm_…` id
   * cannot be resolved and is reported as unsupported rather than guessed at.
   */
  async getPaymentMethod(paymentMethodId: string): Promise<PaymentMethodResult> {
    const id = paymentMethodId?.trim();
    if (!id) {
      throw PaymentError.gatewayError(this.name, 'paymentMethodId is required');
    }
    if (id.startsWith('pm_')) {
      throw PaymentError.gatewayError(
        this.name,
        'paddle_payment_method_not_supported: Paddle exposes card details on the transaction (txn_…), not on a standalone payment method (pm_…)',
      );
    }

    const outcome = await this.call<{ data: PaddleTransaction }>(
      `/transactions/${encodeURIComponent(id)}`,
      'GET',
      undefined,
      { retryable: true },
    );

    if (outcome.status === 'error') {
      throw PaymentError.gatewayError(this.name, `${outcome.code}: ${outcome.message}`);
    }

    const details = outcome.data?.data?.payment_method_details;
    const card = details?.card;
    if (!details) {
      throw PaymentError.gatewayError(
        this.name,
        `paddle_payment_method_not_found: transaction ${id} carries no payment method details`,
      );
    }

    return {
      id,
      type: (details.type ?? card?.brand ?? 'unknown').toLowerCase(),
      last4: card?.last4 ?? undefined,
      expiryMonth: card?.expiry_month ?? undefined,
      expiryYear: card?.expiry_year ?? undefined,
      gatewayUsed: this.name,
    };
  }

  /**
   * Paddle pays the merchant out on its own schedule to the connected bank
   * account, and its API exposes no payout operation — so payouts are reported
   * as failed rather than faked. `PaymentRouter` then falls through to a gateway
   * that can pay out.
   */
  async createPayout(request: PayoutRequest): Promise<PayoutResult> {
    return {
      id: `paddle_po_${request.destination}`,
      status: 'failed',
      amount: request.amount,
      currency: request.currency,
      gatewayUsed: this.name,
      payoutId: '',
      errorMessage:
        'paddle_payouts_unsupported: Paddle settles merchant funds to the connected bank account; route payouts through the settlement account',
      processedAt: new Date().toISOString(),
    };
  }

  private failure(request: PaymentRequest, message: string): PaymentResult {
    return this.buildFailureResult(
      `paddle_txn_${request.idempotencyKey}`,
      request.amount,
      request.currency,
      message,
    );
  }

  private refundFailure(request: RefundRequest, message: string): RefundResult {
    return {
      id: `paddle_ref_${request.chargeId}`,
      chargeId: request.chargeId,
      status: 'failed',
      amount: request.amount ?? 0,
      gatewayUsed: this.name,
      errorMessage: message,
      processedAt: new Date().toISOString(),
    };
  }

  private resolveFetch(): PaddleFetch | undefined {
    if (this.injectedFetch) return this.injectedFetch;
    const candidate = (globalThis as { fetch?: PaddleFetch }).fetch;
    return typeof candidate === 'function' ? candidate : undefined;
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return headers;
  }

  private async call<T>(
    path: string,
    method: 'GET' | 'POST',
    body: Record<string, unknown> | undefined,
    options: { idempotencyKey?: string; retryable?: boolean } = {},
  ): Promise<PaddleOutcome<T>> {
    const fetchImpl = this.resolveFetch();
    if (!fetchImpl) {
      return {
        status: 'error',
        code: 'paddle_fetch_unavailable',
        message: 'no fetch implementation is available in this runtime',
      };
    }

    const url = `${this.baseUrl}${path}`;
    const attempts = options.retryable ? this.maxAttempts : 1;
    let lastError = { code: 'paddle_unreachable', message: 'the request was never attempted' };

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method,
          headers: this.headers(options.idempotencyKey),
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await response.text();

        if (response.status === 429 || response.status >= 500) {
          lastError = {
            code: `paddle_http_${response.status}`,
            message: text.slice(0, 300) || `Paddle API returned HTTP ${response.status}`,
          };
          logger.warn('Paddle request throttled or unavailable', {
            path,
            status: response.status,
            attempt,
          });
        } else if (!response.ok) {
          return {
            status: 'error',
            code: `paddle_http_${response.status}`,
            message: paddleErrorMessage(parseJson(text), `Paddle API returned HTTP ${response.status}`),
          };
        } else if (!text) {
          return { status: 'ok', data: {} as T };
        } else {
          const parsed = parseJson(text);
          if (!parsed) {
            return {
              status: 'error',
              code: 'paddle_invalid_json',
              message: 'Paddle API returned a body that is not JSON',
            };
          }
          return { status: 'ok', data: parsed as T };
        }
      } catch (error) {
        lastError = {
          code: 'paddle_transport_error',
          message: error instanceof Error ? error.message : String(error),
        };
        logger.warn('Paddle request failed', { path, attempt, error: lastError.message });
      }

      if (attempt < attempts) {
        await this.sleep(this.retryBaseDelayMs * attempt);
      }
    }

    return { status: 'error', code: lastError.code, message: lastError.message };
  }
}
