/**
 * Currency Conversion Service – multi-currency support for subscriptions.
 *
 * Provides exchange rate management, currency conversion for subscription
 * prices, invoice amounts, and billing calculations. Supports configurable
 * rate sources, caching, and per-subscription currency preferences.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1121
 */

export type CurrencyCode = string; // ISO 4217, e.g. 'USD', 'EUR', 'GBP'

export interface ExchangeRate {
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: number;
  fetchedAt: number;
  source?: string;
}

export interface CurrencyConfig {
  baseCurrency: CurrencyCode;
  supportedCurrencies: CurrencyCode[];
  /** Rate cache TTL in milliseconds (default: 24h) */
  rateCacheTtlMs: number;
  /** Decimal places for rounding (default: 2) */
  decimalPlaces: number;
}

export interface SubscriptionCurrencyPreference {
  subscriptionId: string;
  currency: CurrencyCode;
  setAt: number;
}

export interface ConversionResult {
  originalAmount: number;
  originalCurrency: CurrencyCode;
  convertedAmount: number;
  targetCurrency: CurrencyCode;
  rate: number;
  rateFetchedAt: number;
}

export interface CurrencyAnalytics {
  totalConversions: number;
  conversionsByCurrency: Record<string, number>;
  supportedCurrencies: CurrencyCode[];
  baseCurrency: CurrencyCode;
  averageRateAge: number; // ms since last fetch
}

const MS_PER_HOUR = 1000 * 60 * 60;

const DEFAULT_SUPPORTED: CurrencyCode[] = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NGN'];

// Approximate static fallback rates (base: USD)
const FALLBACK_RATES: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.5,
  CAD: 1.36,
  AUD: 1.52,
  NGN: 1600,
};

const DEFAULT_CONFIG: CurrencyConfig = {
  baseCurrency: 'USD',
  supportedCurrencies: DEFAULT_SUPPORTED,
  rateCacheTtlMs: 24 * MS_PER_HOUR,
  decimalPlaces: 2,
};

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

export class CurrencyConversionService {
  private config: CurrencyConfig;
  private rates = new Map<string, ExchangeRate>(); // key: `${base}_${quote}`
  private preferences = new Map<string, SubscriptionCurrencyPreference>();
  private conversionCount = 0;
  private conversionsByCurrency: Record<string, number> = {};

  constructor(config?: Partial<CurrencyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Seed with fallback rates
    this.seedFallbackRates();
  }

  /**
   * Seed fallback exchange rates from the static table.
   */
  private seedFallbackRates(): void {
    const now = Date.now();
    for (const [currency, rate] of Object.entries(FALLBACK_RATES)) {
      if (currency === this.config.baseCurrency) continue;
      this.setRate(this.config.baseCurrency, currency, rate, now, 'fallback');
    }
  }

  /**
   * Set or update an exchange rate.
   */
  setRate(
    base: CurrencyCode,
    quote: CurrencyCode,
    rate: number,
    fetchedAt: number = Date.now(),
    source?: string,
  ): ExchangeRate {
    if (rate <= 0) throw new Error('Exchange rate must be positive');
    const key = `${base}_${quote}`;
    const exchangeRate: ExchangeRate = { base, quote, rate, fetchedAt, source };
    this.rates.set(key, exchangeRate);

    // Also set the inverse rate
    const inverseKey = `${quote}_${base}`;
    this.rates.set(inverseKey, {
      base: quote,
      quote: base,
      rate: 1 / rate,
      fetchedAt,
      source,
    });

    return exchangeRate;
  }

  /**
   * Get an exchange rate, returning undefined if not available or stale.
   */
  getRate(base: CurrencyCode, quote: CurrencyCode): ExchangeRate | undefined {
    if (base === quote) {
      return { base, quote, rate: 1, fetchedAt: Date.now(), source: 'identity' };
    }
    const key = `${base}_${quote}`;
    const rate = this.rates.get(key);
    if (!rate) return undefined;

    // Check staleness
    if (Date.now() - rate.fetchedAt > this.config.rateCacheTtlMs) {
      return undefined; // stale
    }

    return rate;
  }

  /**
   * Convert an amount from one currency to another.
   * Throws if no rate is available.
   */
  convert(amount: number, from: CurrencyCode, to: CurrencyCode): ConversionResult {
    if (!Number.isFinite(amount)) {
      throw new Error('Amount must be a finite number');
    }

    if (from === to) {
      return {
        originalAmount: amount,
        originalCurrency: from,
        convertedAmount: this.round(amount),
        targetCurrency: to,
        rate: 1,
        rateFetchedAt: Date.now(),
      };
    }

    const rate = this.getRate(from, to);
    if (!rate) {
      throw new Error(`No exchange rate available for ${from} → ${to}`);
    }

    const converted = this.round(amount * rate.rate);

    this.conversionCount++;
    const key = `${from}_${to}`;
    this.conversionsByCurrency[key] = (this.conversionsByCurrency[key] ?? 0) + 1;

    return {
      originalAmount: amount,
      originalCurrency: from,
      convertedAmount: converted,
      targetCurrency: to,
      rate: rate.rate,
      rateFetchedAt: rate.fetchedAt,
    };
  }

  /**
   * Convert and fall back to the original amount if no rate is available.
   */
  convertSafe(amount: number, from: CurrencyCode, to: CurrencyCode): ConversionResult {
    try {
      return this.convert(amount, from, to);
    } catch {
      return {
        originalAmount: amount,
        originalCurrency: from,
        convertedAmount: this.round(amount),
        targetCurrency: to,
        rate: 1,
        rateFetchedAt: Date.now(),
      };
    }
  }

  /**
   * Set the preferred currency for a subscription.
   */
  setSubscriptionCurrency(subscriptionId: string, currency: CurrencyCode): SubscriptionCurrencyPreference {
    if (!this.isCurrencySupported(currency)) {
      throw new Error(`Currency ${currency} is not supported. Supported: ${this.config.supportedCurrencies.join(', ')}`);
    }

    const pref: SubscriptionCurrencyPreference = {
      subscriptionId,
      currency,
      setAt: Date.now(),
    };
    this.preferences.set(subscriptionId, pref);
    return pref;
  }

  /**
   * Get the preferred currency for a subscription, defaulting to base currency.
   */
  getSubscriptionCurrency(subscriptionId: string): CurrencyCode {
    return this.preferences.get(subscriptionId)?.currency ?? this.config.baseCurrency;
  }

  /**
   * Remove a subscription's currency preference.
   */
  removeSubscriptionCurrency(subscriptionId: string): boolean {
    return this.preferences.delete(subscriptionId);
  }

  /**
   * Check if a currency is supported.
   */
  isCurrencySupported(currency: CurrencyCode): boolean {
    return this.config.supportedCurrencies.includes(currency);
  }

  /**
   * Get all supported currencies.
   */
  getSupportedCurrencies(): CurrencyCode[] {
    return [...this.config.supportedCurrencies];
  }

  /**
   * Add a supported currency.
   */
  addSupportedCurrency(currency: CurrencyCode): void {
    if (!this.config.supportedCurrencies.includes(currency)) {
      this.config.supportedCurrencies.push(currency);
    }
  }

  /**
   * Get the base currency.
   */
  getBaseCurrency(): CurrencyCode {
    return this.config.baseCurrency;
  }

  /**
   * Get all exchange rates.
   */
  getAllRates(): ExchangeRate[] {
    return Array.from(this.rates.values());
  }

  /**
   * List all subscription currency preferences.
   */
  listPreferences(): SubscriptionCurrencyPreference[] {
    return Array.from(this.preferences.values());
  }

  /**
   * Convert a subscription price to the subscriber's preferred currency.
   */
  convertSubscriptionPrice(
    price: number,
    priceCurrency: CurrencyCode,
    subscriptionId: string,
  ): ConversionResult {
    const targetCurrency = this.getSubscriptionCurrency(subscriptionId);
    return this.convertSafe(price, priceCurrency, targetCurrency);
  }

  /**
   * Batch convert amounts for multiple subscriptions.
   */
  batchConvert(
    items: Array<{ amount: number; from: CurrencyCode; to: CurrencyCode }>,
  ): ConversionResult[] {
    return items.map((item) => this.convertSafe(item.amount, item.from, item.to));
  }

  /**
   * Refresh rates from an external fetcher function.
   */
  async refreshRates(
    fetcher: (base: CurrencyCode) => Promise<Record<CurrencyCode, number>>,
  ): Promise<number> {
    const rates = await fetcher(this.config.baseCurrency);
    let count = 0;
    for (const [currency, rate] of Object.entries(rates)) {
      if (currency !== this.config.baseCurrency && rate > 0) {
        this.setRate(this.config.baseCurrency, currency, rate, Date.now(), 'api');
        count++;
      }
    }
    return count;
  }

  /**
   * Get currency analytics.
   */
  getAnalytics(): CurrencyAnalytics {
    const allRates = Array.from(this.rates.values());
    const now = Date.now();
    const ageSum = allRates.reduce((sum, r) => sum + (now - r.fetchedAt), 0);

    return {
      totalConversions: this.conversionCount,
      conversionsByCurrency: { ...this.conversionsByCurrency },
      supportedCurrencies: this.getSupportedCurrencies(),
      baseCurrency: this.getBaseCurrency(),
      averageRateAge: allRates.length > 0 ? Math.round(ageSum / allRates.length) : 0,
    };
  }

  /**
   * Update configuration.
   */
  updateConfig(patch: Partial<CurrencyConfig>): CurrencyConfig {
    this.config = { ...this.config, ...patch };
    return this.config;
  }

  private round(value: number): number {
    const factor = Math.pow(10, this.config.decimalPlaces);
    return Math.round(value * factor) / factor;
  }
}

export const currencyConversionService = new CurrencyConversionService();
