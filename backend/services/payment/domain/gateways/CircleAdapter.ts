import { BasePaymentGateway } from './PaymentGateway';
import type { PaymentRequest, PaymentResult, RefundRequest, RefundResult, CustomerResult, PaymentMethodResult, PayoutRequest, PayoutResult } from '../../interfaces';

export class CircleAdapter extends BasePaymentGateway {
  readonly name = 'circle';

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    if (request.currency !== 'USDC') {
      return this.buildFailureResult(`circle_${Date.now()}`, request.amount, request.currency, 'Circle only supports USDC');
    }
    const id = `circle_ch_${Date.now()}`;
    return this.buildSuccessResult(id, request.amount, request.currency, id);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    return {
      id: `circle_ref_${Date.now()}`,
      chargeId: request.chargeId,
      status: 'succeeded',
      amount: request.amount ?? 0,
      gatewayUsed: this.name,
      processedAt: new Date().toISOString(),
    };
  }

  async createCustomer(email: string, name: string): Promise<CustomerResult> {
    return {
      id: `circle_cus_${Date.now()}`,
      gatewayCustomerId: `circle_cus_${Date.now()}`,
      gatewayUsed: this.name,
    };
  }

  async getPaymentMethod(paymentMethodId: string): Promise<PaymentMethodResult> {
    return {
      id: paymentMethodId,
      type: 'blockchain_address',
      gatewayUsed: this.name,
    };
  }

  async createPayout(request: PayoutRequest): Promise<PayoutResult> {
    return {
      id: `circle_po_${Date.now()}`,
      status: 'succeeded',
      amount: request.amount,
      currency: request.currency,
      gatewayUsed: this.name,
      payoutId: `circle_po_${Date.now()}`,
      processedAt: new Date().toISOString(),
    };
  }
}
