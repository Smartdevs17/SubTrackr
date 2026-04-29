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

export interface Subscription {
  id: string;
  name: string;
  price: number;
  currency: string;
  status: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
}
