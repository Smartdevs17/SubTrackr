export interface SDKOptions {
  apiKey: string;
  environment?: 'production' | 'sandbox';
  baseUrl?: string;
  timeout?: number;
}

export interface AuthContext {
  token: string | null;
  expiresAt: number | null;
}

export type BillingInterval = 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
export type SubscriptionStatus = 'Active' | 'Paused' | 'Cancelled' | 'PastDue';

export interface Plan {
  id: number;
  merchant: string;
  name: string;
  price: number;
  token: string;
  interval: BillingInterval;
  active: boolean;
  subscriber_count: number;
  created_at: number;
}

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
