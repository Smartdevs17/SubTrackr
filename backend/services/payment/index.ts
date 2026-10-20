export {
  MultiChainPaymentRoutingStrategy,
  PaymentRouter,
  paymentRouter,
} from './domain/PaymentRouter';
export type { PaymentRoutingContext, PaymentRoutingStrategy } from './domain/PaymentRouter';
export { StripeAdapter } from './domain/gateways/StripeAdapter';
export { CircleAdapter } from './domain/gateways/CircleAdapter';
export { StellarAdapter } from './domain/gateways/StellarAdapter';
export { ShopifyAdapter } from './domain/gateways/ShopifyAdapter';
export type { ShopifyAdapterOptions, ShopifyFetch, ShopifyFetchResponse } from './domain/gateways/ShopifyAdapter';
export { BasePaymentGateway } from './domain/gateways/PaymentGateway';
export { GatewayConfigController, gatewayConfigController } from './controller/gatewayConfigController';
export type { IPaymentGateway, IPaymentRouter, PaymentRequest, PaymentResult, RefundRequest, RefundResult, CustomerResult, PaymentMethodResult, PayoutRequest, PayoutResult, GatewayConfig } from './interfaces';
export { PaymentError, PaymentErrorCode } from './errors';
export {
  upsertFallbackChain,
  getFallbackChain,
  getAllFallbackChains,
  deleteFallbackChain,
  disableFallbackChain,
  registerGatewayExecutor,
  executeWithFallback,
  getNotifications as getFallbackNotifications,
  markNotificationSent as markFallbackNotificationSent,
  getFallbackHistory,
  getFallbackAnalytics,
  resetFallbackAnalytics,
} from './domain/fallbackChainService';
export type {
  FallbackChain,
  FallbackChainEntry,
  FallbackAttempt,
  FallbackResult,
  FallbackAnalytics,
  FallbackNotification,
  GatewayName,
  FallbackStatus,
} from './domain/fallbackChainService';

// ── Payment intents (Issues #1716, #1717, #1719) ─────────────────────────────
export {
  PaymentIntentService,
  paymentIntentService,
} from './domain/paymentIntentService';
export type {
  PaymentIntent,
  PaymentIntentStatus,
  PaymentIntentRepository,
} from './domain/PaymentIntent';
export { InMemoryPaymentIntentRepository } from './domain/PaymentIntent';
export {
  AssetPolicyService,
  assetPolicyService,
} from './domain/AssetPolicyService';
export type {
  AssetPolicyRule,
  AssetPolicyChain,
  AssetPolicyMode,
} from './domain/AssetPolicyService';
export { AssetNotAllowedError } from './domain/AssetPolicyService';
export {
  PaymentExpiryService,
  paymentExpiryService,
  cancelSubscriptionOnExpiry,
} from './domain/paymentExpiryService';
export { FinalityService, finalityService } from './domain/finalityService';
export {
  PaymentExpirySweeper,
  startPaymentExpirySweeper,
} from './jobs/paymentExpirySweeper';
export { createPaymentRouter } from './router/paymentIntentRouter';
export { createAssetPolicyRouter } from './router/assetPolicyRouter';
