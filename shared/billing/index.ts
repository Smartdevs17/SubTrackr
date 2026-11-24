/** Split instructions for distributing a payment across destination accounts. */
export interface PaymentSplit {
  /** Destination account / customer identifier. */
  destinationAccountId: string;
  /** Percentage of the total amount directed to this account; splits total 100. */
  percentage: number;
}

/** Common charge request accepted by payment gateway adapters. */
export interface PaymentRequest {
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId: string;
  idempotencyKey: string;
  chainId?: number;
  chainType?: 'evm' | 'stellar' | 'fiat';
  metadata?: Record<string, string>;
  /** Merchant whose asset policy is enforced at charge time. */
  merchantId?: string;
  /** Asset code being charged; defaults to `currency`. */
  asset?: string;
  /** Stellar asset issuer for path payments. */
  issuer?: string;
  /** Optional cross-account split configuration. */
  splits?: PaymentSplit[];
}

export interface PaymentResult {
  id: string;
  status: 'succeeded' | 'failed' | 'pending';
  amount: number;
  currency: string;
  gatewayUsed: string;
  chargeId: string;
  errorMessage?: string;
  processedAt: string;
}

export interface RefundRequest {
  chargeId: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, string>;
}

export interface RefundResult {
  id: string;
  chargeId: string;
  status: 'succeeded' | 'failed' | 'pending';
  amount: number;
  gatewayUsed: string;
  errorMessage?: string;
  processedAt: string;
}

export interface CustomerResult {
  id: string;
  gatewayCustomerId: string;
  gatewayUsed: string;
}

export interface PaymentMethodResult {
  id: string;
  type: string;
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  gatewayUsed: string;
}

export interface PayoutRequest {
  amount: number;
  currency: string;
  destination: string;
  metadata?: Record<string, string>;
}

export interface PayoutResult {
  id: string;
  status: 'succeeded' | 'failed' | 'pending';
  amount: number;
  currency: string;
  gatewayUsed: string;
  payoutId: string;
  errorMessage?: string;
  processedAt: string;
}

/** Port implemented by every payment provider adapter. */
export interface IPaymentGateway {
  readonly name: string;
  charge(request: PaymentRequest): Promise<PaymentResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  createCustomer(email: string, name: string): Promise<CustomerResult>;
  getPaymentMethod(paymentMethodId: string): Promise<PaymentMethodResult>;
  createPayout(request: PayoutRequest): Promise<PayoutResult>;
}

export interface GatewayConfig {
  primary: string;
  secondary: string;
  tertiary?: string;
  chainOverrides?: Partial<Record<'evm' | 'stellar' | 'fiat', string[]>>;
}

export interface IPaymentRouter {
  charge(request: PaymentRequest): Promise<PaymentResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  getGateway(name: string): IPaymentGateway;
  registerGateway(name: string, gateway: IPaymentGateway): void;
}

// ── Canonical provider-ID types (issue #2256) ──────────────────────────────────

/** Stable billing provider names. */
export type BillingProvider = 'stripe' | 'paypal' | 'paddle';

/** Kind of entity a provider identifier refers to. */
export type ProviderIdKind =
  'customer' | 'subscription' | 'charge' | 'refund' | 'invoice' | 'payout';

/**
 * A provider-specific identifier, e.g. Stripe `cus_123`, PayPal `CUST-456`,
 * Paddle `ctm_789`. Opaque to the canonical resolver; validation is per-provider.
 */
export type ProviderId = string;

/**
 * A stable, provider-neutral canonical identifier. Derived deterministically
 * from (provider, kind, providerId) so the same input always yields the same
 * canonical ID without a database lookup.
 */
export type CanonicalId = string & { readonly __canonicalIdBrand: unique symbol };

/**
 * Result of resolving a provider ID to its canonical form.
 */
export interface ProviderIdResolution {
  /** The stable canonical ID. */
  canonicalId: CanonicalId;
  /** The provider that issued `providerId`. */
  provider: BillingProvider;
  /** The entity kind the ID refers to. */
  kind: ProviderIdKind;
  /** The original provider-specific identifier. */
  providerId: ProviderId;
}

/**
 * Registry entry mapping a canonical ID back to one or more provider-specific
 * identifiers (needed for denormalisation / reverse lookups).
 */
export interface ProviderIdMapping {
  canonicalId: CanonicalId;
  provider: BillingProvider;
  kind: ProviderIdKind;
  providerId: ProviderId;
}
