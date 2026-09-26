import { PaymentError } from '../errors';
import { logger } from '../../shared/logging';
import type {
  GatewayConfig,
  IPaymentGateway,
  IPaymentRouter,
  PaymentRequest,
  PaymentResult,
  RefundRequest,
  RefundResult,
} from '../interfaces';

export interface PaymentRoutingContext {
  request: PaymentRequest;
  merchantConfig?: GatewayConfig;
  registeredGateways: string[];
}

export interface PaymentRoutingStrategy {
  readonly name: string;
  resolveChargeGateways(context: PaymentRoutingContext): string[];
}

export class MultiChainPaymentRoutingStrategy implements PaymentRoutingStrategy {
  readonly name = 'multi-chain';

  resolveChargeGateways({
    request,
    merchantConfig,
    registeredGateways,
  }: PaymentRoutingContext): string[] {
    const configuredGateways = merchantConfig
      ? [
          ...(merchantConfig.chainOverrides?.[this.resolveChainType(request)] ?? []),
          merchantConfig.primary,
          merchantConfig.secondary,
          ...(merchantConfig.tertiary ? [merchantConfig.tertiary] : []),
        ]
      : [];

    return uniqueGatewayNames([
      ...configuredGateways,
      ...this.defaultGatewaysForRequest(request),
      ...registeredGateways,
    ]);
  }

  private defaultGatewaysForRequest(request: PaymentRequest): string[] {
    const chainType = this.resolveChainType(request);
    if (chainType === 'stellar') {
      return ['stellar', 'circle', 'stripe'];
    }

    if (chainType === 'evm') {
      return normalizedCurrency(request.currency) === 'USDC'
        ? ['circle', 'stellar', 'stripe']
        : ['stripe', 'circle', 'stellar'];
    }

    return ['stripe', 'circle', 'stellar'];
  }

  private resolveChainType(request: PaymentRequest): 'evm' | 'stellar' | 'fiat' {
    if (request.chainType) {
      return request.chainType;
    }

    const metadataChainType = request.metadata?.chainType;
    if (
      metadataChainType === 'evm' ||
      metadataChainType === 'stellar' ||
      metadataChainType === 'fiat'
    ) {
      return metadataChainType;
    }

    if (normalizedCurrency(request.currency) === 'XLM') {
      return 'stellar';
    }

    return 'fiat';
  }
}

export class PaymentRouter implements IPaymentRouter {
  private gateways = new Map<string, IPaymentGateway>();
  private merchantConfigs = new Map<string, GatewayConfig>();
  private routingStrategy: PaymentRoutingStrategy;

  constructor(routingStrategy: PaymentRoutingStrategy = new MultiChainPaymentRoutingStrategy()) {
    this.routingStrategy = routingStrategy;
  }

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

  setRoutingStrategy(strategy: PaymentRoutingStrategy): void {
    this.routingStrategy = strategy;
  }

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    const config = this.merchantConfigs.get(request.customerId);
    const gateways = this.routingStrategy.resolveChargeGateways({
      request,
      merchantConfig: config,
      registeredGateways: [...this.gateways.keys()],
    });

    const errors: string[] = [];

    for (const gatewayName of gateways) {
      const gateway = this.gateways.get(gatewayName);
      if (!gateway) continue;

      try {
        const result = await gateway.charge(request);
        if (result.status === 'succeeded') {
          logger.info('Payment processed', {
            gateway: gatewayName,
            amount: request.amount,
            routingStrategy: this.routingStrategy.name,
            chainId: request.chainId,
            chainType: request.chainType ?? request.metadata?.chainType,
          });
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

function normalizedCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

function uniqueGatewayNames(gateways: string[]): string[] {
  return gateways.filter((gateway, index, list) => gateway && list.indexOf(gateway) === index);
}
