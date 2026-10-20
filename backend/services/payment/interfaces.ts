export interface PaymentSplit {
  /** Destination account / customer identifier. */
  destinationAccountId: string;
  /**
   * Percentage of the total amount directed to this account.
   * All percentages in a request must sum to exactly 100.
   */
  percentage: number;
}

export interface PaymentRequest {
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId: string;
  idempotencyKey: string;
  chainId?: number;
  chainType?: 'evm' | 'stellar' | 'fiat';
  metadata?: Record<string, string>;
  feat/stellar-wave-issues
  /** Merchant whose asset policy is enforced at charge time (Issue #1717). */
  merchantId?: string;
  /** Asset code being charged (defaults to `currency`). */
  asset?: string;
  /** Stellar asset issuer (path payments only). */
  issuer?: string;
  
  /**
   * Optional cross-account split configuration (Issue #1720).
   * When present the payment router distributes the amount across multiple
   * destination accounts proportionally to the listed percentages.
   */
  splits?: PaymentSplit[];
  main
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
