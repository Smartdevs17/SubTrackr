import { paymentRouter } from '../domain/PaymentRouter';
import { StripeAdapter } from '../domain/gateways/StripeAdapter';
import { CircleAdapter } from '../domain/gateways/CircleAdapter';
import { StellarAdapter } from '../domain/gateways/StellarAdapter';
import { ok, fail } from '../../shared/apiResponse';
import type { ApiResponse } from '../../shared/apiResponse';
import type { GatewayConfig } from '../interfaces';

paymentRouter.registerGateway('stripe', new StripeAdapter());
paymentRouter.registerGateway('circle', new CircleAdapter());
paymentRouter.registerGateway('stellar', new StellarAdapter());

export class GatewayConfigController {
  getConfig(merchantId: string, requestId?: string): ApiResponse<GatewayConfig | null> {
    try {
      const config = paymentRouter.getMerchantConfig(merchantId);
      return ok(config ?? null, requestId);
    } catch (err) {
      return fail('INTERNAL_SERVER_ERROR', err instanceof Error ? err.message : 'Failed to get config', requestId);
    }
  }

  setConfig(merchantId: string, config: GatewayConfig, requestId?: string): ApiResponse<GatewayConfig> {
    try {
      if (!config.primary || !config.secondary) {
        return fail('PAYMENT_GATEWAY_CONFIG_INVALID', 'Primary and secondary gateways are required', requestId);
      }
      paymentRouter.setMerchantConfig(merchantId, config);
      return ok(config, requestId);
    } catch (err) {
      return fail('PAYMENT_GATEWAY_CONFIG_INVALID', err instanceof Error ? err.message : 'Invalid config', requestId);
    }
  }

  listGateways(requestId?: string): ApiResponse<string[]> {
    const names = ['stripe', 'circle', 'stellar'];
    return ok(names, requestId);
  }
}

export const gatewayConfigController = new GatewayConfigController();
