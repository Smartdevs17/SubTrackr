/**
 * Shopify subscription-billing gateway (Issue #1235).
 *
 * Subscriptions that are billed through Shopify live on a Shopify *subscription
 * contract*: Shopify owns the stored payment method, the billing cycle and the
 * dunning. This adapter joins that world to the payment router, so a SubTrackr
 * subscription can be charged, refunded and looked up through the same
 * `IPaymentGateway` port as Stripe, Circle and Stellar.
 *
 * Port mapping (Shopify Admin GraphQL API):
 *
 * | Port method          | Shopify operation                  | Notes                                                        |
 * | -------------------- | ---------------------------------- | ------------------------------------------------------------ |
 * | `charge`             | `subscriptionBillingAttemptCreate` | requires `metadata.shopifyContractId`; carries the idempotency key |
 * | `refund`             | `refundCreate`                     | needs the Shopify order id (`metadata.shopifyOrderId` or `chargeId`) |
 * | `createCustomer`     | `customerCreate`                   | —                                                             |
 * | `getPaymentMethod`   | `customerPaymentMethod`            | maps `CustomerCreditCard` to the port's card fields           |
 * | `createPayout`       | —                                  | Shopify's Admin API exposes no merchant payouts; see below    |
 *
 * Two behaviours are deliberate:
 *
 * - **Retries follow the idempotency of the operation.** `charge` and
 *   `getPaymentMethod` are retried on a transport failure, HTTP 429 or a 5xx,
 *   because Shopify de-duplicates a billing attempt by its `idempotencyKey`.
 *   `refund` and `createCustomer` are *not* retried: a retried refund could
 *   refund twice, so the caller decides, with a fresh idempotency key.
 * - **Failures are returned, not thrown, where the port has an error channel.**
 *   `charge` and `refund` return `status: 'failed'` with a machine-readable
 *   `errorMessage`, which is what lets `PaymentRouter` fall through to the next
 *   gateway. `createCustomer` and `getPaymentMethod` have no failure channel in
 *   `interfaces.ts`, so they raise `PaymentError.gatewayError` instead of
 *   returning a hollow success.
 *
 * Configuration (see `.env.example`):
 *
 * ```bash
 * SHOPIFY_SHOP_DOMAIN=<shop>.myshopify.com
 * SHOPIFY_ADMIN_ACCESS_TOKEN=<custom app admin API token>
 * SHOPIFY_API_VERSION=2025-07            # optional
 * ```
 *
 * The custom app needs `read_own_subscription_contracts`,
 * `write_own_subscription_contracts`, `read_customers`, `write_customers`,
 * `read_orders` and `write_orders`. `ShopifyAdapter.fromEnvironment()` returns
 * `null` while the shop is unconfigured, so the container never offers Shopify
 * as a fallback on a deployment that has no Shopify credentials.
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

const DEFAULT_API_VERSION = '2025-07';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

const logger = createLoggerFor('payment.shopify');

export interface ShopifyFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface ShopifyFetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** The slice of `fetch` this adapter needs. Injected in tests. */
export type ShopifyFetch = (
  url: string,
  init: ShopifyFetchInit,
) => Promise<ShopifyFetchResponse>;

export interface ShopifyAdapterOptions {
  /** `<shop>.myshopify.com`. */
  readonly shopDomain: string;
  /** Admin API access token of the custom app. */
  readonly accessToken: string;
  /** Admin API version. Defaults to `2025-07`. */
  readonly apiVersion?: string;
  /** Injected in tests. Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: ShopifyFetch;
  /** Attempts per retryable request. Defaults to 3. */
  readonly maxAttempts?: number;
  /** Base delay between retryable attempts, in ms. Defaults to 250. */
  readonly retryBaseDelayMs?: number;
  /** Injected in tests, so a retry does not wait. Defaults to `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

interface ShopifyUserError {
  readonly field?: readonly (string | null)[] | null;
  readonly message?: string | null;
  readonly code?: string | null;
}

interface BillingAttemptPayload {
  readonly subscriptionBillingAttemptCreate?: {
    readonly subscriptionBillingAttempt?: { readonly id: string; readonly ready: boolean } | null;
    readonly userErrors?: readonly ShopifyUserError[] | null;
  } | null;
}

interface RefundPayload {
  readonly refundCreate?: {
    readonly refund?: { readonly id: string } | null;
    readonly userErrors?: readonly ShopifyUserError[] | null;
  } | null;
}

interface CustomerCreatePayload {
  readonly customerCreate?: {
    readonly customer?: { readonly id: string } | null;
    readonly userErrors?: readonly ShopifyUserError[] | null;
  } | null;
}

interface PaymentMethodPayload {
  readonly customerPaymentMethod?: {
    readonly id: string;
    readonly instrument?: {
      readonly brand?: string | null;
      readonly lastDigits?: string | null;
      readonly expiryMonth?: number | null;
      readonly expiryYear?: number | null;
    } | null;
  } | null;
}

type ShopifyOutcome<T> =
  | { readonly status: 'ok'; readonly data: T }
  | { readonly status: 'error'; readonly code: string; readonly message: string };

const SUBSCRIPTION_BILLING_ATTEMPT_CREATE = `
  mutation SubscriptionBillingAttemptCreate(
    $subscriptionContractId: ID!
    $subscriptionBillingAttemptInput: SubscriptionBillingAttemptInput!
  ) {
    subscriptionBillingAttemptCreate(
      subscriptionContractId: $subscriptionContractId
      subscriptionBillingAttemptInput: $subscriptionBillingAttemptInput
    ) {
      subscriptionBillingAttempt {
        id
        ready
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const REFUND_CREATE = `
  mutation RefundCreate($input: RefundInput!) {
    refundCreate(input: $input) {
      refund {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const CUSTOMER_CREATE = `
  mutation CustomerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const CUSTOMER_PAYMENT_METHOD = `
  query CustomerPaymentMethod($id: ID!) {
    customerPaymentMethod(id: $id) {
      id
      instrument {
        ... on CustomerCreditCard {
          brand
          lastDigits
          expiryMonth
          expiryYear
        }
      }
    }
  }
`;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJson(text: string): {
  data?: unknown;
  errors?: readonly { readonly message?: string | null }[];
} | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as { data?: unknown; errors?: readonly { message?: string | null }[] };
  } catch {
    return null;
  }
}

/** Shopify's `userErrors` array, reduced to the first message. */
function firstUserErrorMessage(errors: readonly ShopifyUserError[] | null | undefined): string | null {
  for (const error of errors ?? []) {
    const message = error?.message?.trim();
    if (message) return message;
  }
  return null;
}

export class ShopifyAdapter extends BasePaymentGateway {
  readonly name = 'shopify';

  private readonly shopDomain: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly injectedFetch: ShopifyFetch | undefined;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ShopifyAdapterOptions) {
    super();

    const shopDomain = options.shopDomain?.trim();
    const accessToken = options.accessToken?.trim();
    if (!shopDomain) {
      throw PaymentError.gatewayError('shopify', 'shopDomain is required');
    }
    if (!accessToken) {
      throw PaymentError.gatewayError('shopify', 'accessToken is required');
    }

    this.shopDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    this.accessToken = accessToken;
    this.apiVersion = options.apiVersion?.trim() || DEFAULT_API_VERSION;
    this.injectedFetch = options.fetchImpl;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Builds an adapter from the environment, or `null` when the shop is not
   * configured. The container uses this so an unconfigured deployment never
   * lists Shopify as a fallback gateway.
   */
  static fromEnvironment(
    env: Record<string, string | undefined> = process.env,
  ): ShopifyAdapter | null {
    const shopDomain = env.SHOPIFY_SHOP_DOMAIN?.trim();
    const accessToken = env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
    if (!shopDomain || !accessToken) {
      logger.info('Shopify gateway not configured; skipping registration');
      return null;
    }
    return new ShopifyAdapter({
      shopDomain,
      accessToken,
      apiVersion: env.SHOPIFY_API_VERSION?.trim() || undefined,
    });
  }

  /**
   * Starts a billing attempt on the subscription contract behind the request.
   * The attempt is idempotent per `request.idempotencyKey`, so a retried charge
   * cannot bill the subscriber twice.
   */
  async charge(request: PaymentRequest): Promise<PaymentResult> {
    const contractId = request.metadata?.shopifyContractId?.trim();
    if (!contractId) {
      return this.failure(
        request,
        'shopify_contract_missing: charge() requires metadata.shopifyContractId',
      );
    }

    const outcome = await this.call<BillingAttemptPayload>(
      'subscriptionBillingAttemptCreate',
      SUBSCRIPTION_BILLING_ATTEMPT_CREATE,
      {
        subscriptionContractId: contractId,
        subscriptionBillingAttemptInput: {
          idempotencyKey: request.idempotencyKey,
          originTime: new Date().toISOString(),
        },
      },
      { idempotencyKey: request.idempotencyKey, retryable: true },
    );

    if (outcome.status === 'error') {
      logger.warn('Shopify charge failed', {
        code: outcome.code,
        message: outcome.message,
        contractId,
      });
      return this.failure(request, `${outcome.code}: ${outcome.message}`);
    }

    const payload = outcome.data.subscriptionBillingAttemptCreate;
    const userError = firstUserErrorMessage(payload?.userErrors);
    if (userError) {
      return this.failure(request, `shopify_user_error: ${userError}`);
    }

    const attempt = payload?.subscriptionBillingAttempt;
    if (!attempt?.id) {
      return this.failure(
        request,
        'shopify_empty_response: subscriptionBillingAttemptCreate returned no attempt',
      );
    }

    // `ready: false` means Shopify accepted the attempt and is still settling
    // it; the router treats that as a non-terminal outcome, not a failure.
    if (!attempt.ready) {
      return {
        id: attempt.id,
        status: 'pending',
        amount: request.amount,
        currency: request.currency,
        gatewayUsed: this.name,
        chargeId: attempt.id,
        processedAt: new Date().toISOString(),
      };
    }

    return this.buildSuccessResult(attempt.id, request.amount, request.currency, attempt.id);
  }

  /**
   * Refunds against the Shopify order behind the charge. Not retried: a second
   * `refundCreate` would refund the customer twice.
   */
  async refund(request: RefundRequest): Promise<RefundResult> {
    const orderId = request.metadata?.shopifyOrderId?.trim() || request.chargeId?.trim();
    const amount = request.amount ?? 0;

    if (!orderId) {
      return this.refundFailure(request, 'shopify_order_missing: refund() requires an order id');
    }

    const outcome = await this.call<RefundPayload>(
      'refundCreate',
      REFUND_CREATE,
      {
        input: {
          orderId,
          notify: false,
          note: request.reason,
          transactions: [
            {
              orderId,
              gateway: 'shopify_payments',
              kind: 'REFUND',
              amount: amount.toFixed(2),
            },
          ],
        },
      },
      { retryable: false },
    );

    if (outcome.status === 'error') {
      return this.refundFailure(request, `${outcome.code}: ${outcome.message}`);
    }

    const payload = outcome.data.refundCreate;
    const userError = firstUserErrorMessage(payload?.userErrors);
    if (userError) {
      return this.refundFailure(request, `shopify_user_error: ${userError}`);
    }

    const refund = payload?.refund;
    if (!refund?.id) {
      return this.refundFailure(request, 'shopify_empty_response: refundCreate returned no refund');
    }

    return {
      id: refund.id,
      chargeId: orderId,
      status: 'succeeded',
      amount,
      gatewayUsed: this.name,
      processedAt: new Date().toISOString(),
    };
  }

  async createCustomer(email: string, name: string): Promise<CustomerResult> {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const firstName = parts.shift();

    const outcome = await this.call<CustomerCreatePayload>(
      'customerCreate',
      CUSTOMER_CREATE,
      {
        input: {
          email,
          firstName,
          lastName: parts.length > 0 ? parts.join(' ') : undefined,
        },
      },
      { retryable: false },
    );

    if (outcome.status === 'error') {
      throw PaymentError.gatewayError(this.name, `${outcome.code}: ${outcome.message}`);
    }

    const payload = outcome.data.customerCreate;
    const userError = firstUserErrorMessage(payload?.userErrors);
    if (userError) {
      throw PaymentError.gatewayError(this.name, `shopify_user_error: ${userError}`);
    }

    const customer = payload?.customer;
    if (!customer?.id) {
      throw PaymentError.gatewayError(
        this.name,
        'shopify_empty_response: customerCreate returned no customer',
      );
    }

    logger.info('Shopify customer created', { customerId: customer.id });
    return { id: customer.id, gatewayCustomerId: customer.id, gatewayUsed: this.name };
  }

  async getPaymentMethod(paymentMethodId: string): Promise<PaymentMethodResult> {
    const outcome = await this.call<PaymentMethodPayload>(
      'customerPaymentMethod',
      CUSTOMER_PAYMENT_METHOD,
      { id: paymentMethodId },
      { retryable: true },
    );

    if (outcome.status === 'error') {
      throw PaymentError.gatewayError(this.name, `${outcome.code}: ${outcome.message}`);
    }

    const method = outcome.data.customerPaymentMethod;
    if (!method?.id) {
      throw PaymentError.gatewayError(
        this.name,
        `shopify_payment_method_not_found: no payment method ${paymentMethodId}`,
      );
    }

    return {
      id: method.id,
      type: method.instrument?.brand?.toLowerCase() ?? 'unknown',
      last4: method.instrument?.lastDigits ?? undefined,
      expiryMonth: method.instrument?.expiryMonth ?? undefined,
      expiryYear: method.instrument?.expiryYear ?? undefined,
      gatewayUsed: this.name,
    };
  }

  /**
   * Shopify's Admin API exposes no merchant payout operation — settlements are
   * handled by Shopify Payments against the shop's bank account — so payouts
   * are reported as failed rather than faked. `PaymentRouter` then falls
   * through to a gateway that can pay out.
   */
  async createPayout(request: PayoutRequest): Promise<PayoutResult> {
    return {
      id: `shopify_po_${request.destination}`,
      status: 'failed',
      amount: request.amount,
      currency: request.currency,
      gatewayUsed: this.name,
      payoutId: '',
      errorMessage:
        'shopify_payouts_unsupported: Shopify settles merchant funds itself; route payouts through the settlement account',
      processedAt: new Date().toISOString(),
    };
  }

  private failure(request: PaymentRequest, message: string): PaymentResult {
    return this.buildFailureResult(
      `shopify_ch_${request.idempotencyKey}`,
      request.amount,
      request.currency,
      message,
    );
  }

  private refundFailure(request: RefundRequest, message: string): RefundResult {
    return {
      id: `shopify_ref_${request.chargeId}`,
      chargeId: request.chargeId,
      status: 'failed',
      amount: request.amount ?? 0,
      gatewayUsed: this.name,
      errorMessage: message,
      processedAt: new Date().toISOString(),
    };
  }

  private resolveFetch(): ShopifyFetch | undefined {
    if (this.injectedFetch) return this.injectedFetch;
    const candidate = (globalThis as { fetch?: ShopifyFetch }).fetch;
    return typeof candidate === 'function' ? candidate : undefined;
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Shopify-Access-Token': this.accessToken,
    };
    // Forwarded on every request: the REST Admin API de-duplicates a retried
    // call with this header, and the GraphQL Admin API ignores headers it does
    // not know. The billing attempt's own idempotency key lives in the mutation
    // input, which is where GraphQL idempotency actually comes from.
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return headers;
  }

  private async call<T>(
    operation: string,
    query: string,
    variables: Record<string, unknown>,
    options: { idempotencyKey?: string; retryable?: boolean } = {},
  ): Promise<ShopifyOutcome<T>> {
    const fetchImpl = this.resolveFetch();
    if (!fetchImpl) {
      return {
        status: 'error',
        code: 'shopify_fetch_unavailable',
        message: 'no fetch implementation is available in this runtime',
      };
    }

    const url = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
    const body = JSON.stringify({ query, variables });
    const attempts = options.retryable ? this.maxAttempts : 1;
    let lastError = {
      code: 'shopify_unreachable',
      message: 'the request was never attempted',
    };

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: this.headers(options.idempotencyKey),
          body,
        });

        if (response.status === 429 || response.status >= 500) {
          const text = await response.text();
          lastError = {
            code: `shopify_http_${response.status}`,
            message: text.slice(0, 300) || `Shopify Admin API returned HTTP ${response.status}`,
          };
          logger.warn('Shopify request throttled or unavailable', {
            operation,
            status: response.status,
            attempt,
          });
        } else if (!response.ok) {
          const text = await response.text();
          return {
            status: 'error',
            code: `shopify_http_${response.status}`,
            message: text.slice(0, 300) || `Shopify Admin API returned HTTP ${response.status}`,
          };
        } else {
          const text = await response.text();
          const parsed = parseJson(text);
          if (!parsed) {
            return {
              status: 'error',
              code: 'shopify_invalid_json',
              message: 'Shopify Admin API returned a body that is not JSON',
            };
          }

          const graphErrors = (parsed.errors ?? [])
            .map((error) => error?.message?.trim())
            .filter((message): message is string => Boolean(message));
          if (graphErrors.length > 0) {
            return {
              status: 'error',
              code: 'shopify_graphql_error',
              message: graphErrors.join('; '),
            };
          }

          return { status: 'ok', data: (parsed.data ?? {}) as T };
        }
      } catch (error) {
        lastError = {
          code: 'shopify_transport_error',
          message: error instanceof Error ? error.message : String(error),
        };
        logger.warn('Shopify request failed', { operation, attempt, error: lastError.message });
      }

      if (attempt < attempts) {
        await this.sleep(this.retryBaseDelayMs * attempt);
      }
    }

    return { status: 'error', code: lastError.code, message: lastError.message };
  }
}
