import {
  CreatePlanRequest,
  InitializeRequest,
  Plan,
  PlanIdRequest,
  RequestRefundRequest,
  SDKOptions,
  SubscriberRequest,
  SubscriberSubscriptionRequest,
  Subscription,
  SubscriptionIdRequest,
  Webhook,
} from './types';
import { AuthManager } from './auth';
import { ApiError } from './errors';

export class SubTrackrClient {
  private authManager: AuthManager;
  private baseUrl: string;

  constructor(options: SDKOptions) {
    this.authManager = new AuthManager(options);
    this.baseUrl =
      options.baseUrl ||
      (options.environment === 'sandbox'
        ? 'https://sandbox.api.subtrackr.app'
        : 'https://api.subtrackr.app');
  }

  private async request<T>(endpoint: string, method: string = 'GET', body?: unknown): Promise<T> {
    const token = await this.authManager.getToken();
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new ApiError(
        errorData.message || 'API request failed',
        response.status,
        errorData.code
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // Contract APIs generated from docs/openapi.yaml
  async initialize(data: InitializeRequest): Promise<void> {
    return this.request<void>('/initialize', 'POST', data);
  }

  async createPlan(data: CreatePlanRequest): Promise<number> {
    return this.request<number>('/create_plan', 'POST', data);
  }

  async deactivatePlan(data: PlanIdRequest & { merchant: string }): Promise<void> {
    return this.request<void>('/deactivate_plan', 'POST', data);
  }

  async subscribe(data: { subscriber: string; plan_id: number }): Promise<number> {
    return this.request<number>('/subscribe', 'POST', data);
  }

  async cancelSubscription(data: SubscriberSubscriptionRequest): Promise<void> {
    return this.request<void>('/cancel_subscription', 'POST', data);
  }

  async pauseSubscription(data: SubscriberSubscriptionRequest): Promise<void> {
    return this.request<void>('/pause_subscription', 'POST', data);
  }

  async resumeSubscription(data: SubscriberSubscriptionRequest): Promise<void> {
    return this.request<void>('/resume_subscription', 'POST', data);
  }

  async chargeSubscription(data: SubscriptionIdRequest): Promise<void> {
    return this.request<void>('/charge_subscription', 'POST', data);
  }

  async requestRefund(data: RequestRefundRequest): Promise<void> {
    return this.request<void>('/request_refund', 'POST', data);
  }

  async approveRefund(data: SubscriptionIdRequest): Promise<void> {
    return this.request<void>('/approve_refund', 'POST', data);
  }

  async rejectRefund(data: SubscriptionIdRequest): Promise<void> {
    return this.request<void>('/reject_refund', 'POST', data);
  }

  async getPlan(data: PlanIdRequest): Promise<Plan> {
    return this.request<Plan>('/get_plan', 'POST', data);
  }

  async getSubscription(data: SubscriptionIdRequest): Promise<Subscription> {
    return this.request<Subscription>('/get_subscription', 'POST', data);
  }

  async getUserSubscriptions(data: SubscriberRequest): Promise<number[]> {
    return this.request<number[]>('/get_user_subscriptions', 'POST', data);
  }

  async getMerchantPlans(data: { merchant: string }): Promise<number[]> {
    return this.request<number[]>('/get_merchant_plans', 'POST', data);
  }

  async getPlanCount(): Promise<number> {
    return this.request<number>('/get_plan_count', 'POST');
  }

  async getSubscriptionCount(): Promise<number> {
    return this.request<number>('/get_subscription_count', 'POST');
  }

  // REST APIs
  async getSubscriptions(): Promise<Subscription[]> {
    return this.request<Subscription[]>('/v1/subscriptions');
  }

  async createSubscription(data: Omit<Subscription, 'id' | 'status'>): Promise<Subscription> {
    return this.request<Subscription>('/v1/subscriptions', 'POST', data);
  }

  // Webhooks APIs
  async getWebhooks(): Promise<Webhook[]> {
    return this.request<Webhook[]>('/v1/webhooks');
  }

  async createWebhook(data: Omit<Webhook, 'id'>): Promise<Webhook> {
    return this.request<Webhook>('/v1/webhooks', 'POST', data);
  }
}
