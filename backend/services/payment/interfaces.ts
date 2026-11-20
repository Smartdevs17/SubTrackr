/**
 * Backwards-compatible import path for payment contracts.
 * New gateway code should import from `@subtrackr/billing-types` directly.
 */
export type {
  CustomerResult,
  GatewayConfig,
  IPaymentGateway,
  IPaymentRouter,
  PaymentMethodResult,
  PaymentRequest,
  PaymentResult,
  PaymentSplit,
  PayoutRequest,
  PayoutResult,
  RefundRequest,
  RefundResult,
} from '@subtrackr/billing-types';
