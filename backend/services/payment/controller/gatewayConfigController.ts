import { paymentRouter } from '../domain/PaymentRouter';
import { StripeAdapter } from '../domain/gateways/StripeAdapter';
import { CircleAdapter } from '../domain/gateways/CircleAdapter';
import { StellarAdapter } from '../domain/gateways/StellarAdapter';
import { PaddleAdapter } from '../domain/gateways/PaddleAdapter';
import { ok, fail } from '../../shared/apiResponse';
import type { ApiResponse } from '../../shared/apiResponse';
import type { GatewayConfig } from '../interfaces';

paymentRouter.registerGateway('stripe', new StripeAdapter());
paymentRouter.registerGateway('circle', new CircleAdapter());
paymentRouter.registerGateway('stellar', new StellarAdapter());

// Paddle is a merchant-of-record, so it earns its place in a fallback chain by
// handling tax and settlement. It registers only when PADDLE_API_KEY is set, and
// an unconfigured deployment must not offer it as a fallback that cannot charge.
const paddleAdapter = PaddleAdapter.fromEnvironment();
if (paddleAdapter) {
  paymentRouter.registerGateway('paddle', paddleAdapter);
}

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
    return ok(paymentRouter.getRegisteredGatewayNames(), requestId);
  }
}

export const gatewayConfigController = new GatewayConfigController();
