import { BasePaymentGateway } from './PaymentGateway';
import type { PaymentRequest, PaymentResult, RefundRequest, RefundResult, CustomerResult, PaymentMethodResult, PayoutRequest, PayoutResult } from '../../interfaces';

export class StellarAdapter extends BasePaymentGateway {
  readonly name = 'stellar';

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    const id = `stellar_tx_${Date.now()}`;
    return this.buildSuccessResult(id, request.amount, request.currency, id);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    return {
      id: `stellar_ref_${Date.now()}`,
      chargeId: request.chargeId,
      status: 'succeeded',
      amount: request.amount ?? 0,
      gatewayUsed: this.name,
      processedAt: new Date().toISOString(),
    };
  }

  async createCustomer(email: string, name: string): Promise<CustomerResult> {
    return {
      id: `stellar_cus_${Date.now()}`,
      gatewayCustomerId: `stellar_cus_${Date.now()}`,
      gatewayUsed: this.name,
    };
  }

  async getPaymentMethod(paymentMethodId: string): Promise<PaymentMethodResult> {
    return {
      id: paymentMethodId,
      type: 'stellar_address',
      gatewayUsed: this.name,
    };
  }

  async createPayout(request: PayoutRequest): Promise<PayoutResult> {
    return {
      id: `stellar_po_${Date.now()}`,
      status: 'succeeded',
      amount: request.amount,
      currency: request.currency,
      gatewayUsed: this.name,
      payoutId: `stellar_po_${Date.now()}`,
      processedAt: new Date().toISOString(),
    };
  }
}
