export interface PaymentRequest {
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
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
}

export interface IPaymentRouter {
  charge(request: PaymentRequest): Promise<PaymentResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  getGateway(name: string): IPaymentGateway;
  registerGateway(name: string, gateway: IPaymentGateway): void;
}
