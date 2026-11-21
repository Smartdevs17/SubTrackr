/**
 * backend/src/services/priceAlerts.ts
 *
 * Issue #2013 — price-change alerter with provider scraping fallback.
 *
 * A primary market-data API is used for every quote. When it fails, the
 * alerter tries an injected fallback and then a scraper-backed provider before
 * giving up; a recent cached quote can still be served inside a bounded
 * staleness window. Alerts are deduplicated per rule with a cooldown and are
 * delivered through an injected sink so notification transport stays outside
 * this module. All outcomes emit structured logs and Prometheus-style metrics.
 */

import { logger as defaultLogger } from '../utils/logger';

// ── Public types ──────────────────────────────────────────────────────────────

export type PriceSource = 'api' | 'scrape';

export type AlertDirection = 'up' | 'down' | 'both';

export interface PriceQuote {
  symbol: string;
  price: number;
  currency: string;
  source: PriceSource;
  observedAt: number;
}

export interface PriceProvider {
  readonly source: PriceSource;
  fetchPrice(symbol: string): Promise<PriceQuote>;
}

export interface ScrapeRule {
  symbol: string;
  pattern: RegExp;
  currency?: string;
}

export interface PriceScraper {
  scrape(symbol: string): Promise<string>;
}

export interface AlertRule {
  id: string;
  symbol: string;
  /** Absolute percentage move required to trigger, e.g. 2.5 for 2.5%. */
  changePercent: number;
  direction?: AlertDirection;
  cooldownMs?: number;
  recipients?: string[];
}

export interface PriceAlert {
  id: string;
  ruleId: string;
  symbol: string;
  direction: 'up' | 'down';
  previousPrice: number;
  currentPrice: number;
  changePercent: number;
  triggeredAt: number;
  recipients: string[];
  source: PriceSource;
}

export interface AlertSink {
  send(alert: PriceAlert): Promise<void>;
}

export interface PriceAlertsLogger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface PriceAlertsMetrics {
  increment?(name: string, value?: number, tags?: Record<string, string>): void;
  gauge?(name: string, value: number, tags?: Record<string, string>): void;
  timing?(name: string, milliseconds: number, tags?: Record<string, string>): void;
}

export type PriceAlertErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_QUOTE'
  | 'FETCH_FAILED'
  | 'PARSE_FAILED'
  | 'NO_DATA'
  | 'STALE_DATA';

export class PriceAlertError extends Error {
  constructor(
    public readonly code: PriceAlertErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PriceAlertError';
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const METRIC_PREFIX = 'subtrackr.priceAlerts';
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_MAX_STALENESS_MS = 5 * 60_000;
const DEFAULT_COOLDOWN_MS = 15 * 60_000;

// ── Pure helpers ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normaliseQuote(
  input: Partial<PriceQuote>,
  source: PriceSource,
  now: () => number = Date.now
): PriceQuote {
  if (!input || typeof input.symbol !== 'string' || input.symbol.trim() === '') {
    throw new PriceAlertError('INVALID_QUOTE', 'A quote needs a symbol');
  }
  const price = typeof input.price === 'string' ? Number(input.price) : input.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new PriceAlertError('INVALID_QUOTE', 'A quote needs a positive numeric price');
  }
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) {
    throw new PriceAlertError('INVALID_QUOTE', 'A quote needs an upper-case ISO currency');
  }
  const observedAt = input.observedAt ?? now();
  if (typeof observedAt !== 'number' || !Number.isFinite(observedAt)) {
    throw new PriceAlertError('INVALID_QUOTE', 'A quote needs a numeric observedAt');
  }
  return {
    symbol: input.symbol.trim().toUpperCase(),
    price,
    currency: input.currency,
    source,
    observedAt,
  };
}

/** Parse the first numeric value matched by `pattern`, tolerating separators. */
export function parsePriceFromText(text: string, pattern: RegExp): number {
  if (typeof text !== 'string' || !text.trim()) {
    throw new PriceAlertError('PARSE_FAILED', 'Scraped page is empty');
  }
  pattern.lastIndex = 0;
  const match = pattern.exec(text);
  const candidate = match && match[1] !== undefined ? match[1] : match?.[0];
  if (!candidate) {
    throw new PriceAlertError('PARSE_FAILED', 'Scraped page did not contain a price');
  }
  const cleaned = candidate.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const price = Number(cleaned);
  if (!Number.isFinite(price) || price <= 0) {
    throw new PriceAlertError('PARSE_FAILED', 'Scraped price is not a positive number');
  }
  return price;
}

export function changePercent(previous: number, current: number): number {
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) return 0;
  return ((current - previous) / previous) * 100;
}

export function shouldAlert(
  previous: PriceQuote,
  current: PriceQuote,
  rule: AlertRule
): 'up' | 'down' | null {
  if (previous.symbol !== current.symbol) return null;
  const delta = changePercent(previous.price, current.price);
  const direction: 'up' | 'down' | null = delta > 0 ? 'up' : delta < 0 ? 'down' : null;
  if (!direction) return null;
  if (rule.direction && rule.direction !== 'both' && rule.direction !== direction) return null;
  return Math.abs(delta) >= rule.changePercent ? direction : null;
}

function validateRules(rules: AlertRule[]): void {
  if (!Array.isArray(rules)) {
    throw new PriceAlertError('INVALID_REQUEST', 'rules must be an array');
  }
  const ids = new Set<string>();
  for (const rule of rules) {
    if (!rule || typeof rule.id !== 'string' || !rule.id.trim() || ids.has(rule.id)) {
      throw new PriceAlertError('INVALID_REQUEST', 'Alert rules need unique ids');
    }
    if (typeof rule.symbol !== 'string' || !rule.symbol.trim()) {
      throw new PriceAlertError('INVALID_REQUEST', `Rule ${rule.id} needs a symbol`);
    }
    if (!Number.isFinite(rule.changePercent) || rule.changePercent <= 0) {
      throw new PriceAlertError('INVALID_REQUEST', `Rule ${rule.id} needs a positive threshold`);
    }
    if (rule.direction && !['up', 'down', 'both'].includes(rule.direction)) {
      throw new PriceAlertError('INVALID_REQUEST', `Rule ${rule.id} has an invalid direction`);
    }
    ids.add(rule.id);
  }
}

// ── Providers ─────────────────────────────────────────────────────────────────

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<HttpResponseLike>;

export interface HttpPriceProviderOptions {
  url: string | ((symbol: string) => string);
  fetchImpl?: FetchLike;
  apiKey?: string;
  headers?: Record<string, string>;
  currency?: string;
  now?: () => number;
}

function readNumber(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

export function createHttpPriceProvider(options: HttpPriceProviderOptions): PriceProvider {
  const now = options.now ?? Date.now;
  return {
    source: 'api',
    async fetchPrice(symbol: string): Promise<PriceQuote> {
      try {
        const url = typeof options.url === 'function' ? options.url(symbol) : options.url;
        const headers: Record<string, string> = { ...(options.headers ?? {}) };
        if (options.apiKey) headers['x-api-key'] = options.apiKey;
        const response = await options.fetchImpl?.(url, { headers });
        if (!response) {
          throw new PriceAlertError('FETCH_FAILED', 'No fetch implementation configured');
        }
        if (!response.ok) {
          throw new PriceAlertError(
            'FETCH_FAILED',
            `Price API returned ${response.status}`,
            false,
            {
              status: response.status,
            }
          );
        }
        const body: unknown = await response.json();
        if (!isRecord(body)) {
          throw new PriceAlertError('INVALID_QUOTE', 'Price API response is not an object');
        }
        const rawPrice = readNumber(body, ['price', 'value', 'last', 'lastPrice', 'close']);
        const rawCurrency = readNumber(body, ['currency', 'quoteCurrency']) ?? options.currency;
        const rawTime = readNumber(body, ['observedAt', 'timestamp', 'updatedAt']);
        const observedAt =
          typeof rawTime === 'string' && !Number.isNaN(Date.parse(rawTime))
            ? Date.parse(rawTime)
            : typeof rawTime === 'number'
              ? rawTime
              : now();
        return normaliseQuote(
          {
            symbol,
            price: rawPrice as PriceQuote['price'],
            currency: rawCurrency as string,
            observedAt,
          },
          'api',
          now
        );
      } catch (error) {
        if (error instanceof PriceAlertError) throw error;
        throw new PriceAlertError('FETCH_FAILED', 'Price API request failed', true, error);
      }
    },
  };
}

export interface ScrapePriceProviderOptions {
  scraper: PriceScraper;
  rules: ScrapeRule[];
  currency?: string;
  now?: () => number;
}

export function createScrapePriceProvider(options: ScrapePriceProviderOptions): PriceProvider {
  const rules = new Map(options.rules.map((rule) => [rule.symbol.toUpperCase(), rule]));
  const now = options.now ?? Date.now;
  return {
    source: 'scrape',
    async fetchPrice(symbol: string): Promise<PriceQuote> {
      const rule = rules.get(symbol.toUpperCase());
      if (!rule) {
        throw new PriceAlertError('NO_DATA', `No scrape rule for ${symbol}`);
      }
      try {
        const text = await options.scraper.scrape(symbol);
        const price = parsePriceFromText(text, rule.pattern);
        return normaliseQuote(
          {
            symbol,
            price,
            currency: rule.currency ?? options.currency ?? 'USD',
            observedAt: now(),
          },
          'scrape',
          now
        );
      } catch (error) {
        if (error instanceof PriceAlertError) throw error;
        throw new PriceAlertError('FETCH_FAILED', 'Scrape source is unavailable', true, error);
      }
    },
  };
}

// ── Alerter ───────────────────────────────────────────────────────────────────

export interface PriceAlerterOptions {
  primary: PriceProvider;
  fallback?: PriceProvider;
  scrape?: ScrapePriceProviderOptions;
  rules: AlertRule[];
  sink: AlertSink;
  logger?: PriceAlertsLogger;
  metrics?: PriceAlertsMetrics;
  now?: () => number;
  idFactory?: () => string;
  cacheTtlMs?: number;
  maxStalenessMs?: number;
}

export interface ResolvedQuote {
  quote: PriceQuote;
  cacheHit: boolean;
  stale: boolean;
}

export interface PriceCheckResult extends ResolvedQuote {
  alerts: PriceAlert[];
}

export interface PriceAlerter {
  getQuote(symbol: string): Promise<ResolvedQuote>;
  evaluate(quote: PriceQuote): Promise<PriceAlert[]>;
  check(symbol: string): Promise<PriceCheckResult>;
  setBaseline(quote: PriceQuote): void;
  getBaseline(symbol: string): PriceQuote | undefined;
}

export function createPriceAlerter(options: PriceAlerterOptions): PriceAlerter {
  validateRules(options.rules);
  const providers: PriceProvider[] = [options.primary];
  if (options.fallback) providers.push(options.fallback);
  if (options.scrape) providers.push(createScrapePriceProvider(options.scrape));
  const sink = options.sink;
  const log = options.logger ?? defaultLogger;
  const metrics = options.metrics;
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? (() => `alert-${Date.now()}-${Math.random()}`);
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxStalenessMs = options.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS;

  const cache = new Map<string, PriceQuote>();
  const baselines = new Map<string, PriceQuote>();
  const lastAlertAt = new Map<string, number>();

  const emit = (name: string, tags?: Record<string, string>): void => {
    metrics?.increment?.(`${METRIC_PREFIX}.${name}`, 1, tags);
  };

  const service: PriceAlerter = {
    async getQuote(symbol: string): Promise<ResolvedQuote> {
      const key = symbol.trim().toUpperCase();
      const cached = cache.get(key);
      if (cached && now() - cached.observedAt <= cacheTtlMs) {
        emit('cache_hit', { symbol: key });
        return { quote: cached, cacheHit: true, stale: false };
      }

      let lastError: unknown;
      for (const provider of providers) {
        const startedAt = now();
        try {
          const quote = normaliseQuote(await provider.fetchPrice(key), provider.source, now);
          if (quote.symbol !== key) {
            throw new PriceAlertError('INVALID_QUOTE', 'Provider returned the wrong symbol');
          }
          cache.set(key, quote);
          emit('fetch_succeeded', { symbol: key, source: provider.source });
          metrics?.timing?.(`${METRIC_PREFIX}.fetch`, Math.max(0, now() - startedAt), {
            symbol: key,
            source: provider.source,
          });
          return { quote, cacheHit: false, stale: false };
        } catch (error) {
          lastError = error;
          const code = error instanceof PriceAlertError ? error.code : 'FETCH_FAILED';
          emit('fetch_failed', { symbol: key, source: provider.source, code });
          log.warn?.('Price provider failed', { symbol: key, source: provider.source, code });
        }
      }

      if (cached && now() - cached.observedAt <= maxStalenessMs) {
        emit('stale_served', { symbol: key });
        log.warn?.('Serving stale price quote', {
          symbol: key,
          ageMs: now() - cached.observedAt,
        });
        return { quote: cached, cacheHit: false, stale: true };
      }
      if (lastError instanceof PriceAlertError) throw lastError;
      throw new PriceAlertError('NO_DATA', `No price available for ${key}`, true, lastError);
    },

    async evaluate(quote: PriceQuote): Promise<PriceAlert[]> {
      const previous = baselines.get(quote.symbol);
      if (!previous) {
        baselines.set(quote.symbol, quote);
        return [];
      }

      const alerts: PriceAlert[] = [];
      for (const rule of options.rules) {
        if (rule.symbol.toUpperCase() !== quote.symbol) continue;
        const direction = shouldAlert(previous, quote, rule);
        if (!direction) continue;

        const lastAt = lastAlertAt.get(rule.id) ?? Number.NEGATIVE_INFINITY;
        const cooldownMs = rule.cooldownMs ?? DEFAULT_COOLDOWN_MS;
        if (now() - lastAt < cooldownMs) {
          emit('alert_suppressed', { ruleId: rule.id, symbol: quote.symbol });
          continue;
        }

        const delta = changePercent(previous.price, quote.price);
        const alert: PriceAlert = {
          id: idFactory(),
          ruleId: rule.id,
          symbol: quote.symbol,
          direction,
          previousPrice: previous.price,
          currentPrice: quote.price,
          changePercent: Math.abs(delta),
          triggeredAt: now(),
          recipients: [...(rule.recipients ?? [])],
          source: quote.source,
        };
        try {
          await sink.send(alert);
          lastAlertAt.set(rule.id, now());
          alerts.push(alert);
          emit('alert_sent', { ruleId: rule.id, symbol: quote.symbol, direction });
          metrics?.gauge?.(`${METRIC_PREFIX}.change_percent`, Math.abs(delta), {
            symbol: quote.symbol,
          });
          log.info?.('Price alert sent', {
            ruleId: rule.id,
            symbol: quote.symbol,
            direction,
            changePercent: Math.abs(delta),
          });
        } catch (error) {
          emit('alert_failed', { ruleId: rule.id, symbol: quote.symbol });
          log.error?.('Price alert delivery failed', {
            ruleId: rule.id,
            symbol: quote.symbol,
            error: error instanceof Error ? error.message : 'unknown',
          });
        }
      }
      baselines.set(quote.symbol, quote);
      return alerts;
    },

    async check(symbol: string): Promise<PriceCheckResult> {
      const resolved = await service.getQuote(symbol);
      const alerts = await service.evaluate(resolved.quote);
      return { ...resolved, alerts };
    },

    setBaseline(quote: PriceQuote): void {
      baselines.set(quote.symbol, normaliseQuote(quote, quote.source, now));
    },

    getBaseline(symbol: string): PriceQuote | undefined {
      return baselines.get(symbol.trim().toUpperCase());
    },
  };
  return service;
}
