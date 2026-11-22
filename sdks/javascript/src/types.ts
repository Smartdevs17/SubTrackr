export interface SDKOptions {
  apiKey: string;
  environment?: 'production' | 'sandbox';
  baseUrl?: string;
  timeout?: number;
  /**
   * Target API version to use for all requests.
   * Defaults to CURRENT_API_VERSION (2).
   * Must be >= MIN_SUPPORTED_API_VERSION (1).
   */
  apiVersion?: number;
  /**
   * Whether to emit console warnings when the SDK detects deprecated usage
   * or an older API version in a server response.
   * Defaults to true.
   */
  warnOnDeprecation?: boolean;
}

export interface AuthContext {
  token: string | null;
  expiresAt: number | null;
}

// On-chain contract types come from the shared package so the SDK cannot drift
// from contracts/types/src/lib.rs. `BillingInterval` is kept as an alias for
// backwards compatibility; it now includes `Daily`, which the contract supports.
import type { Interval, SubscriptionStatus } from '../../../shared/types/contract';
export type { Interval, Plan, SubscriptionStatus } from '../../../shared/types/contract';
export type BillingInterval = Interval;

export interface Subscription {
  id: number | string;
  plan_id?: number;
  subscriber?: string;
  name?: string;
  price?: number;
  currency?: string;
  status: SubscriptionStatus | string;
  started_at?: number;
  last_charged_at?: number;
  next_charge_at?: number;
  total_paid?: number;
  refund_requested_amount?: number;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
}

export interface InitializeRequest {
  admin: string;
}

export interface CreatePlanRequest {
  merchant: string;
  name: string;
  price: number;
  token: string;
  interval: BillingInterval;
}

export interface PlanIdRequest {
  plan_id: number;
}

export interface SubscriberRequest {
  subscriber: string;
}

export interface SubscriptionIdRequest {
  subscription_id: number;
}

export interface SubscriberSubscriptionRequest extends SubscriptionIdRequest {
  subscriber: string;
}

export interface RequestRefundRequest extends SubscriptionIdRequest {
  amount: number;
}
