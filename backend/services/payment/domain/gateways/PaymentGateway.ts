import type { IPaymentGateway, PaymentRequest, PaymentResult, RefundRequest, RefundResult, CustomerResult, PaymentMethodResult, PayoutRequest, PayoutResult } from '../../interfaces';

export abstract class BasePaymentGateway implements IPaymentGateway {
  abstract readonly name: string;

  abstract charge(request: PaymentRequest): Promise<PaymentResult>;
  abstract refund(request: RefundRequest): Promise<RefundResult>;
  abstract createCustomer(email: string, name: string): Promise<CustomerResult>;
  abstract getPaymentMethod(paymentMethodId: string): Promise<PaymentMethodResult>;
  abstract createPayout(request: PayoutRequest): Promise<PayoutResult>;

  protected buildSuccessResult(id: string, amount: number, currency: string, chargeId: string): PaymentResult {
    return {
      id,
      status: 'succeeded',
      amount,
      currency,
      gatewayUsed: this.name,
      chargeId,
      processedAt: new Date().toISOString(),
    };
  }

  protected buildFailureResult(id: string, amount: number, currency: string, errorMessage: string): PaymentResult {
    return {
      id,
      status: 'failed',
      amount,
      currency,
      gatewayUsed: this.name,
      chargeId: '',
      errorMessage,
      processedAt: new Date().toISOString(),
    };
  }
}
