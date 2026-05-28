import { Subscription } from '../types/subscription';

interface OraclePrice {
  token: string;
  quote: string;
  price: number;
  decimals: number;
  timestamp: number;
  source: 'primary' | 'fallback';
}

interface CachedPrice {
  price: number;
  fetchedAt: number;
  ttl: number;
}

export class OraclePriceService {
  private cache = new Map<string, CachedPrice>();
  private defaultTtlMs = 600_000;
  private baseUrl: string;

  constructor(baseUrl = '/api/oracle') {
    this.baseUrl = baseUrl;
  }

  async getFiatPrice(token: string, quote = 'USD'): Promise<OraclePrice | null> {
    const cacheKey = `${token}:${quote}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
      return { token, quote, price: cached.price, decimals: 7, timestamp: cached.fetchedAt, source: 'primary' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/price/${token}/${quote}`);
      if (!response.ok) return null;
      const data: OraclePrice = await response.json();
      this.cache.set(cacheKey, { price: data.price, fetchedAt: Date.now(), ttl: this.defaultTtlMs });
      return data;
    } catch {
      return null;
    }
  }

  async enrichSubscriptionWithFiat(subscription: Subscription): Promise<Subscription> {
    if (!subscription.isCryptoEnabled || !subscription.cryptoToken) {
      return subscription;
    }

    const oraclePrice = await this.getFiatPrice(subscription.cryptoToken);
    if (!oraclePrice) return subscription;

    const cryptoAmount = subscription.cryptoAmount ?? subscription.price;
    const fiatPrice = (cryptoAmount * oraclePrice.price) / 10 ** oraclePrice.decimals;
    const deviationBps = subscription.price > 0
      ? Math.abs(Math.round(((fiatPrice - subscription.price) / subscription.price) * 10000))
      : 0;

    return {
      ...subscription,
      fiatPrice,
      fiatCurrency: oraclePrice.quote,
      fiatPriceUpdatedAt: new Date(oraclePrice.timestamp * 1000),
      oraclePriceDeviationBps: deviationBps,
    };
  }

  async enrichSubscriptionsWithFiat(subscriptions: Subscription[]): Promise<Subscription[]> {
    return Promise.all(subscriptions.map((sub) => this.enrichSubscriptionWithFiat(sub)));
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const oraclePriceService = new OraclePriceService();
