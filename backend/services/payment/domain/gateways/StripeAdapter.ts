import { BasePaymentGateway } from './PaymentGateway';
import type { PaymentRequest, PaymentResult, RefundRequest, RefundResult, CustomerResult, PaymentMethodResult, PayoutRequest, PayoutResult } from '../../interfaces';

export class StripeAdapter extends BasePaymentGateway {
  readonly name = 'stripe';

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    const id = `stripe_ch_${Date.now()}`;
    return this.buildSuccessResult(id, request.amount, request.currency, id);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    return {
      id: `stripe_ref_${Date.now()}`,
      chargeId: request.chargeId,
      status: 'succeeded',
      amount: request.amount ?? 0,
      gatewayUsed: this.name,
      processedAt: new Date().toISOString(),
    };
  }

  async createCustomer(email: string, name: string): Promise<CustomerResult> {
    return {
      id: `cus_${Date.now()}`,
      gatewayCustomerId: `stripe_cus_${Date.now()}`,
      gatewayUsed: this.name,
    };
  }

  async getPaymentMethod(paymentMethodId: string): Promise<PaymentMethodResult> {
    return {
      id: paymentMethodId,
      type: 'card',
      last4: '4242',
      gatewayUsed: this.name,
    };
  }

  async createPayout(request: PayoutRequest): Promise<PayoutResult> {
    return {
      id: `stripe_po_${Date.now()}`,
      status: 'succeeded',
      amount: request.amount,
      currency: request.currency,
      gatewayUsed: this.name,
      payoutId: `stripe_po_${Date.now()}`,
      processedAt: new Date().toISOString(),
    };
  }
}
