import { SDKOptions, Subscription, Webhook } from './types';
import { AuthManager } from './auth';
import { ApiError } from './errors';

export class SubTrackrClient {
  private authManager: AuthManager;
  private baseUrl: string;

  constructor(options: SDKOptions) {
    this.authManager = new AuthManager(options);
    this.baseUrl = options.baseUrl || (options.environment === 'sandbox' 
      ? 'https://sandbox.api.subtrackr.app' 
      : 'https://api.subtrackr.app');
  }

  private async request<T>(endpoint: string, method: string = 'GET', body?: any): Promise<T> {
    const token = await this.authManager.getToken();
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new ApiError(errorData.message || 'API request failed', response.status, errorData.code);
    }

    return response.json();
  }

  // Subscriptions APIs
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
