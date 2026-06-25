import { PaymentError } from '../errors';
import { logger } from '../../shared/logging';
import type { IPaymentGateway, IPaymentRouter, PaymentRequest, PaymentResult, RefundRequest, RefundResult, GatewayConfig } from '../interfaces';

export class PaymentRouter implements IPaymentRouter {
  private gateways = new Map<string, IPaymentGateway>();
  private merchantConfigs = new Map<string, GatewayConfig>();

  registerGateway(name: string, gateway: IPaymentGateway): void {
    this.gateways.set(name, gateway);
    logger.info('Payment gateway registered', { name });
  }

  getGateway(name: string): IPaymentGateway {
    const gateway = this.gateways.get(name);
    if (!gateway) throw PaymentError.gatewayNotFound(name);
    return gateway;
  }

  setMerchantConfig(merchantId: string, config: GatewayConfig): void {
    this.merchantConfigs.set(merchantId, config);
  }

  getMerchantConfig(merchantId: string): GatewayConfig | undefined {
    return this.merchantConfigs.get(merchantId);
  }

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    const config = this.merchantConfigs.get(request.customerId);
    const gateways = config
      ? [config.primary, config.secondary, ...(config.tertiary ? [config.tertiary] : [])]
      : ['stripe', 'circle', 'stellar'];

    const errors: string[] = [];

    for (const gatewayName of gateways) {
      const gateway = this.gateways.get(gatewayName);
      if (!gateway) continue;

      try {
        const result = await gateway.charge(request);
        if (result.status === 'succeeded') {
          logger.info('Payment processed', { gateway: gatewayName, amount: request.amount });
          return result;
        }
        errors.push(`${gatewayName}: ${result.errorMessage ?? 'declined'}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${gatewayName}: ${message}`);
        logger.warn('Gateway charge failed, attempting fallback', { gateway: gatewayName, error: message });
      }
    }

    throw PaymentError.gatewayError('all', `All gateways failed: ${errors.join('; ')}`);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const errors: string[] = [];

    for (const [, gateway] of this.gateways) {
      try {
        const result = await gateway.refund(request);
        if (result.status === 'succeeded') return result;
        errors.push(`${gateway.name}: ${result.errorMessage ?? 'declined'}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${gateway.name}: ${message}`);
      }
    }

    throw PaymentError.gatewayError('all', `All gateways refund failed: ${errors.join('; ')}`);
  }
}

export const paymentRouter = new PaymentRouter();
