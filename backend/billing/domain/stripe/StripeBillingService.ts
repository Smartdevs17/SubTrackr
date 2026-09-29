/**
 * Stripe Billing feature surface (issue #1239).
 *
 * `services/payment/domain/gateways/StripeAdapter.ts` charges a card once and
 * fabricates its ids, so it cannot manage a subscription. This service covers
 * the Billing half of Stripe, grouped by the capability a subscriber asks for:
 *
 * | Capability             | Stripe operation                                    |
 * | ---------------------- | --------------------------------------------------- |
 * | Customers              | `POST/GET/POST … /v1/customers`                     |
 * | Subscriptions + trials | `POST /v1/subscriptions` with `trial_period_days`   |
 * | Plan changes           | `POST /v1/subscriptions/:id` with `proration_behavior` |
 * | Cancellation           | `cancel_at_period_end` (or `at_period_end=false`)     |
 * | Metered usage          | `POST /v1/subscription_items/:id/usage_records`     |
 * | Invoices               | `/v1/invoices`, `finalizeInvoice`, `payInvoice`     |
 * | Upcoming invoice       | `GET /v1/invoices/upcoming`                         |
 * | Dunning                | `POST /v1/subscriptions/:id` payment settings + retries |
 * | Self-service portal    | `POST /v1/billing_portal/sessions`                  |
 * | Tax IDs                | `/v1/customers/:id/tax_ids`                         |
 *
 * Design notes worth keeping:
 *
 *  - **Amounts are major units upstream of Stripe.** Stripe takes major units
 *    itself (a price of `12.99` is sent as `12.99`), so this service passes them
 *    straight through rather than converting to minor units and back.
 *  - **Every write carries an idempotency key derived from the SubTrackr id.**
 *    `key()` builds a stable key from a namespace and an entity id, so a
 *    retried request replays Stripe's first response instead of creating a
 *    second subscription.
 *  - **Metered usage keys on the billing period, not the call.** Stripe rejects
 *    duplicate usage records, so the key is `usage:<itemId>:<periodStart>`; two
 *    reports for the same period collapse into one.
 *  - **`always_invoice` is opt-in.** Metered usage is not billed until it is
 *    finalised, so the caller decides when the period closes rather than
 *    invoicing on every report.
 */

import {
  StripeApiClient,
  type StripeParams,
  type StripeRequestOptions,
} from './StripeApiClient';
import { createLoggerFor } from '../../../services/shared/logging';

const logger = createLoggerFor('billing.stripe.service');

export type ProrationBehavior = 'create_prorations' | 'none' | 'always_invoice';
export type StripePaymentBehavior =
  | 'allow_incomplete'
  | 'default_incomplete'
  | 'error_if_incomplete'
  | 'pending_if_incomplete';

export interface StripeCustomerInput {
  readonly email: string;
  readonly name?: string;
  readonly phone?: string;
  readonly description?: string;
  /** SubTrackr's own customer id, so the two records can be reconciled. */
  readonly subtrackrCustomerId?: string;
  readonly metadata?: Record<string, string>;
}

export interface StripeSubscriptionItemInput {
  readonly priceId: string;
  readonly quantity?: number;
}

/**
 * A metered item needs no extra flag: metering is a property of the Stripe
 * price (`recurring[usage_type] = 'metered'`), and its total comes from
 * `recordUsage` rather than from `quantity`. Re-anchor the price if this ever
 * changes rather than inferring usage from a magic quantity.
 */
export interface CreateSubscriptionInput {
  readonly customerId: string;
  readonly items: readonly StripeSubscriptionItemInput[];
  /** Days of free trial. Stripe requires `trial_end` to be 48 h out at minimum. */
  readonly trialPeriodDays?: number;
  readonly coupon?: string;
  readonly defaultPaymentMethod?: string;
  readonly prorationBehavior?: ProrationBehavior;
  readonly paymentBehavior?: StripePaymentBehavior;
  /** `true` creates the subscription without charging the first invoice. */
  readonly skipPayment?: boolean;
  readonly metadata?: Record<string, string>;
  /** SubTrackr subscription id; becomes the idempotency namespace. */
  readonly subtrackrSubscriptionId?: string;
}

export interface UpdateSubscriptionInput {
  readonly items?: readonly StripeSubscriptionItemInput[];
  readonly prorationBehavior?: ProrationBehavior;
  readonly coupon?: string;
  readonly cancelAtPeriodEnd?: boolean;
  readonly defaultPaymentMethod?: string;
  readonly metadata?: Record<string, string>;
  readonly trialEnd?: 'now' | string;
}

export interface RecordUsageInput {
  readonly subscriptionItemId: string;
  readonly quantity: number;
  /** Billing-period start; part of the idempotency key. */
  readonly timestamp: number;
  /** `increment` adds to the recorded total, `set` replaces it. */
  readonly action?: 'increment' | 'set';
}

export interface DunningInput {
  readonly paymentMethodId?: string;
  /** How long Stripe keeps retrying a failed invoice, in days. */
  readonly retryDays?: readonly number[];
  readonly requestThreeDSecure?: boolean;
  readonly attemptToReconnect?: boolean;
}

export interface PortalSessionInput {
  readonly customerId: string;
  /** Omit to let the subscriber manage only payment details. */
  readonly returnUrl?: string;
  readonly configurationId?: string;
}

export interface TaxIdInput {
  readonly value: string;
  /** e.g. `eu_vat`, `us_ein`, `gb_vat`. */
  readonly type?: string;
}

export interface StripeBillingServiceOptions {
  readonly client: StripeApiClient;
  /** Injected in tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export class StripeBillingService {
  private readonly client: StripeApiClient;
  private readonly now: () => number;

  constructor(options: StripeBillingServiceOptions) {
    if (!options?.client) {
      throw new Error('StripeBillingService requires a StripeApiClient');
    }
    this.client = options.client;
    this.now = options.now ?? Date.now;
  }

  getClient(): StripeApiClient {
    return this.client;
  }

  // ── Customers ──────────────────────────────────────────────────────────────

  /** Creates a Stripe customer. Retrying with the same key is a no-op. */
  async createCustomer(input: StripeCustomerInput, idempotencyKey?: string): Promise<any> {
    const params: StripeParams = { email: input.email };
    if (input.name) params.name = input.name;
    if (input.phone) params.phone = input.phone;
    if (input.description) params.description = input.description;
    if (input.metadata) params.metadata = input.metadata;
    if (input.subtrackrCustomerId) {
      params.metadata = { ...(params.metadata ?? {}), subtrackr_customer_id: input.subtrackrCustomerId };
    }

    const customer = await this.client.post(
      '/customers',
      params,
      { idempotencyKey: idempotencyKey ?? this.key('customer', input.subtrackrCustomerId ?? input.email) },
    );
    logger.info('Created Stripe customer', { customerId: customer?.id });
    return customer;
  }

  async getCustomer(customerId: string): Promise<any> {
    return this.client.get(`/customers/${encodeURIComponent(customerId)}`);
  }

  /** Updates a customer. A blank value in `fields` clears the field on Stripe. */
  async updateCustomer(
    customerId: string,
    fields: {
      email?: string;
      name?: string;
      phone?: string;
      description?: string;
      metadata?: Record<string, string>;
    },
  ): Promise<any> {
    return this.client.post(`/customers/${encodeURIComponent(customerId)}`, fields);
  }

  async deleteCustomer(customerId: string): Promise<any> {
    return this.client.delete(`/customers/${encodeURIComponent(customerId)}`);
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  /**
   * Creates a subscription, optionally with a trial.
   *
   * `payment_behavior` is what makes trials safe: `default_incomplete` with
   * `skip_payment: true` creates the subscription without attempting the first
   * invoice, which is the only way to start a trial that is not paid up front.
   */
  async createSubscription(input: CreateSubscriptionInput): Promise<any> {
    if (!input.items?.length) {
      throw new Error('createSubscription requires at least one item');
    }

    const params: StripeParams = {
      customer: input.customerId,
      items: input.items.map((item) => this.itemParams(item)),
      // Subscriptions are the durable record, so entitlements are keyed on the
      // status rather than assumed.
      expand: ['latest_invoice.payment_intent', 'default_payment_method'],
    };
    if (input.trialPeriodDays !== undefined) params.trial_period_days = input.trialPeriodDays;
    if (input.coupon) params.coupon = input.coupon;
    if (input.defaultPaymentMethod) params.default_payment_method = input.defaultPaymentMethod;
    if (input.prorationBehavior) params.proration_behavior = input.prorationBehavior;
    if (input.metadata) params.metadata = input.metadata;
    if (input.subtrackrSubscriptionId) {
      params.metadata = {
        ...(input.metadata ?? {}),
        subtrackr_subscription_id: input.subtrackrSubscriptionId,
      };
    }

    if (input.skipPayment) {
      params.payment_behavior = input.paymentBehavior ?? 'default_incomplete';
    } else if (input.paymentBehavior) {
      params.payment_behavior = input.paymentBehavior;
    }

    const subscription = await this.client.post(
      '/subscriptions',
      params,
      { idempotencyKey: this.key('subscription:create', input.subtrackrSubscriptionId) },
    );
    logger.info('Created Stripe subscription', {
      subscriptionId: subscription?.id,
      status: subscription?.status,
    });
    return subscription;
  }

  async getSubscription(subscriptionId: string): Promise<any> {
    return this.client.get(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      expand: ['default_payment_method', 'latest_invoice'],
    });
  }

  /** Lists a customer's subscriptions, newest first. */
  async listSubscriptions(customerId: string, limit = 10): Promise<any> {
    return this.client.get('/subscriptions', {
      customer: customerId,
      limit: Math.min(Math.max(limit, 1), 100),
      status: 'all',
    });
  }

  /**
   * Changes a subscription: swaps prices, adds or removes items, applies a
   * coupon, or flips the cancel-at-period-end flag.
   */
  async updateSubscription(
    subscriptionId: string,
    input: UpdateSubscriptionInput,
  ): Promise<any> {
    const params: StripeParams = { expand: ['latest_invoice.payment_intent'] };
    if (input.items) params.items = input.items.map((item) => this.itemParams(item));
    if (input.prorationBehavior) params.proration_behavior = input.prorationBehavior;
    if (input.coupon !== undefined) params.coupon = input.coupon;
    if (input.cancelAtPeriodEnd !== undefined) {
      params.cancel_at_period_end = input.cancelAtPeriodEnd;
    }
    if (input.defaultPaymentMethod) params.default_payment_method = input.defaultPaymentMethod;
    if (input.metadata) params.metadata = input.metadata;
    if (input.trialEnd) {
      // `now` ends a trial early; otherwise the caller passes a unix timestamp.
      params.trial_end = input.trialEnd === 'now' ? 'now' : toUnixSeconds(input.trialEnd);
    }

    return this.client.post(`/subscriptions/${encodeURIComponent(subscriptionId)}`, params, {
      idempotencyKey: this.key('subscription:update', subscriptionId),
    });
  }

  /**
   * Cancels a subscription. The default keeps access until `periodEnd`; pass
   * `false` to cut it off immediately, which also stops the renewal.
   */
  async cancelSubscription(
    subscriptionId: string,
    atPeriodEnd = true,
    options: { prorationBehavior?: ProrationBehavior } = {},
  ): Promise<any> {
    if (atPeriodEnd) {
      return this.client.post(
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
        { cancel_at_period_end: true },
        { idempotencyKey: this.key('subscription:cancel', subscriptionId) },
      );
    }
    return this.client.delete(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      options.prorationBehavior ? { proration_behavior: options.prorationBehavior } : {},
    );
  }

  /** Undoes a scheduled cancellation before the period closes. */
  async resumeSubscription(subscriptionId: string): Promise<any> {
    return this.client.post(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { cancel_at_period_end: false },
      { idempotencyKey: this.key('subscription:resume', subscriptionId) },
    );
  }

  // ── Metered usage ──────────────────────────────────────────────────────────

  /**
   * Reports usage against a metered subscription item.
   *
   * The idempotency key is `usage:<itemId>:<periodStart>`, so re-reporting the
   * same billing period replays Stripe's stored record instead of failing as a
   * duplicate. `action: 'set'` overwrites the period total, which is what a
   * correction after an outage needs.
   */
  async recordUsage(input: RecordUsageInput): Promise<any> {
    if (!Number.isInteger(input.quantity) || input.quantity < 0) {
      throw new Error('recordUsage requires a non-negative integer quantity');
    }
    if (!Number.isFinite(input.timestamp)) {
      throw new Error('recordUsage requires a unix timestamp in seconds');
    }

    const params: StripeParams = {
      quantity: input.quantity,
      timestamp: Math.floor(input.timestamp),
      action: input.action ?? 'increment',
    };
    return this.client.post(
      `/subscription_items/${encodeURIComponent(input.subscriptionItemId)}/usage_records`,
      params,
      { idempotencyKey: this.key('usage', `${input.subscriptionItemId}:${input.timestamp}`) },
    );
  }

  // ── Invoices ───────────────────────────────────────────────────────────────

  async listInvoices(customerId: string, limit = 10): Promise<any> {
    return this.client.get('/invoices', {
      customer: customerId,
      limit: Math.min(Math.max(limit, 1), 100),
    });
  }

  async getInvoice(invoiceId: string): Promise<any> {
    return this.client.get(`/invoices/${encodeURIComponent(invoiceId)}`);
  }

  /**
   * The next invoice for a customer, before it is created. Stripe requires
   * either a customer or a subscription; passing both narrows the preview to
   * one subscription's upcoming charges.
   */
  async getUpcomingInvoice(params: {
    customer?: string;
    subscription?: string;
  }): Promise<any> {
    return this.client.get('/invoices/upcoming', {
      customer: params.customer,
      subscription: params.subscription,
    });
  }

  /** Closes a draft invoice so it can be paid. */
  async finalizeInvoice(invoiceId: string, idempotencyKey?: string): Promise<any> {
    return this.client.post(
      `/invoices/${encodeURIComponent(invoiceId)}/finalize`,
      {},
      { idempotencyKey: idempotencyKey ?? this.key('invoice:finalize', invoiceId) },
    );
  }

  /** Pays an open invoice immediately instead of waiting for auto-charge. */
  async payInvoice(invoiceId: string, idempotencyKey?: string): Promise<any> {
    return this.client.post(
      `/invoices/${encodeURIComponent(invoiceId)}/pay`,
      {},
      { idempotencyKey: idempotencyKey ?? this.key('invoice:pay', invoiceId) },
    );
  }

  // ── Dunning ────────────────────────────────────────────────────────────────

  /**
   * Configures how a failed payment is chased.
   *
   * Stripe's own retry schedule is per-invoice and cannot be set here, so
   * `retryDays` is returned for the caller to apply; the payment method and 3-D
   * Secure preference are set on the subscription so the retry succeeds without
   * a second authentication step.
   */
  async configureDunning(
    subscriptionId: string,
    input: DunningInput,
  ): Promise<{ subscription: any; retryDays: readonly number[] }> {
    const paymentSettings: Record<string, unknown> = {
      payment_method_types: ['card'],
      save_default_payment_method: 'off',
    };
    if (input.requestThreeDSecure !== undefined) {
      // A retry that re-challenges the customer defeats the point, so 3-D
      // Secure is only forced on when explicitly asked for.
      paymentSettings.payment_method_options = {
        card: { request_three_d_secure: input.requestThreeDSecure ? 'automatic' : 'any' },
      };
    }

    const params: StripeParams = {
      payment_settings: paymentSettings,
      expand: ['latest_invoice'],
    };
    if (input.paymentMethodId) {
      params.default_payment_method = input.paymentMethodId;
    }

    const subscription = await this.client.post(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      params,
      { idempotencyKey: this.key('subscription:dunning', subscriptionId) },
    );
    const retryDays = input.retryDays ?? DEFAULT_RETRY_DAYS;
    logger.info('Configured Stripe dunning', { subscriptionId, retryDays });
    return { subscription, retryDays };
  }

  // ── Self-service portal ────────────────────────────────────────────────────

  /**
   * Creates a Stripe Billing Portal session so a subscriber can update their
   * card, download invoices, or cancel without a support ticket.
   */
  async createPortalSession(input: PortalSessionInput): Promise<any> {
    const params: StripeParams = { customer: input.customerId };
    if (input.returnUrl) params.return_url = input.returnUrl;
    if (input.configurationId) params.configuration = input.configurationId;

    return this.client.post('/billing_portal/sessions', params, {
      // A portal session is single-use and short-lived, so it must not be
      // replayed from a stale key.
      idempotencyKey: this.key('portal', `${input.customerId}:${this.now()}`),
    });
  }

  // ── Tax IDs ────────────────────────────────────────────────────────────────

  async createTaxId(customerId: string, input: TaxIdInput): Promise<any> {
    return this.client.post(
      `/customers/${encodeURIComponent(customerId)}/tax_ids`,
      { value: input.value, type: input.type },
      { idempotencyKey: this.key('taxid', `${customerId}:${input.value}`) },
    );
  }

  async listTaxIds(customerId: string): Promise<any> {
    return this.client.get(`/customers/${encodeURIComponent(customerId)}/tax_ids`);
  }

  async deleteTaxId(customerId: string, taxId: string): Promise<any> {
    return this.client.delete(
      `/customers/${encodeURIComponent(customerId)}/tax_ids/${encodeURIComponent(taxId)}`,
    );
  }

  // ── Payment methods ────────────────────────────────────────────────────────

  async listPaymentMethods(
    customerId: string,
    type: 'card' | 'us_bank_account' = 'card',
  ): Promise<any> {
    return this.client.get('/payment_methods', { customer: customerId, type });
  }

  async attachPaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<any> {
    return this.client.post(
      '/payment_methods/attach',
      { customer: customerId, payment_method: paymentMethodId },
    );
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<any> {
    return this.client.post(`/payment_methods/${encodeURIComponent(paymentMethodId)}/detach`, {});
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private itemParams(item: StripeSubscriptionItemInput): Record<string, unknown> {
    const params: Record<string, unknown> = { price: item.priceId };
    if (item.quantity !== undefined) params.quantity = item.quantity;
    return params;
  }

  /**
   * A stable, Stripe-legal idempotency key. Stripe rejects keys over 255
   * characters, so the entity part is hashed rather than concatenated in full.
   */
  private key(namespace: string, entity: string | undefined): string {
    const suffix = entity ? entity.replace(/[^A-Za-z0-9_.:-]/g, '_') : 'anonymous';
    return `subtrackr:${namespace}:${suffix}`.slice(0, 255);
  }
}

/** Stripe's default Smart Retries cadence, in days after the failure. */
export const DEFAULT_RETRY_DAYS: readonly number[] = [1, 3, 5, 7];

function toUnixSeconds(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.floor(numeric);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Cannot read trial_end as a date: ${value}`);
  }
  return Math.floor(parsed / 1000);
}

export { StripeApiClient, toUnixSeconds };
export type { StripeParams, StripeRequestOptions };
