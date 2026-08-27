export interface SubTrackrClientConfig {
  baseUrl?: string;
  apiKey?: string;
  token?: string;
}

export class SubTrackrClient {
  private baseUrl: string;
  private apiKey?: string;
  private token?: string;

  constructor(config: SubTrackrClientConfig = {}) {
    this.baseUrl = config.baseUrl || 'https://api.subtrackr.io/v1';
    this.apiKey = config.apiKey;
    this.token = config.token;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    return headers;
  }

  async getSubscriptions(): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/subscriptions`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`SubTrackr API Error: ${res.statusText}`);
    }
    return res.json();
  }

  async createSubscription(data: Record<string, any>): Promise<any> {
    const res = await fetch(`${this.baseUrl}/subscriptions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`SubTrackr API Error: ${res.statusText}`);
    }
    return res.json();
  }
}
