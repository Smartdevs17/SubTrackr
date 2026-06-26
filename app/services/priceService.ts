// ════════════════════════════════════════════════════════════════
// PRICE SERVICE - Oracle-backed price feeds for crypto subscriptions
// ════════════════════════════════════════════════════════════════
//
// Mirrors the `subtrackr-oracle` Soroban contract on the client side so the
// app can charge accurate USD-equivalent amounts. It adds, on top of a raw
// feed:
//   * caching with a per-pair TTL,
//   * a fallback feed for redundancy,
//   * a circuit breaker that opens after repeated faults,
//   * staleness detection, and
//   * deviation-threshold alerts.
//
// Feeds are injected (`PriceFeed`) so the same logic backs the on-chain oracle,
// a Chainlink/Band HTTP source, or a mock used in tests.

/** A price quote for a `token/quote` pair, value expressed as a JS number. */
export interface Price {
  token: string;
  quote: string;
  /** Human-readable price (already divided by 10^decimals). */
  value: number;
  /** Ledger/observation time in unix seconds. */
  timestamp: number;
  source: 'primary' | 'fallback';
}

/** A source able to return the latest quote for a pair, or null if unavailable. */
export interface PriceFeed {
  readonly name: string;
  getPrice(token: string, quote: string): Promise<Price | null>;
}

export interface FeedConfig {
  primary: PriceFeed;
  fallback?: PriceFeed;
  /** Observations older than this many seconds are rejected. */
  maxStalenessSecs: number;
  /** Inter-update deviation (basis points) above which an alert fires. */
  deviationThresholdBps: number;
  /** Cache TTL in seconds for `getPriceWithCache`. */
  cacheTtlSecs: number;
}

/** Listener invoked when a new quote deviates beyond the configured threshold. */
export type DeviationAlert = (info: {
  token: string;
  quote: string;
  previous: number;
  current: number;
  deviationBps: number;
}) => void;

const CIRCUIT_FAULT_LIMIT = 3;
const CIRCUIT_COOLDOWN_SECS = 3600;

export class PriceServiceError extends Error {
  constructor(
    public readonly code:
      | 'FEED_NOT_FOUND'
      | 'NO_PRICE_AVAILABLE'
      | 'STALE_PRICE'
      | 'CIRCUIT_OPEN',
    message: string,
  ) {
    super(message);
    this.name = 'PriceServiceError';
  }
}

interface CircuitState {
  tripped: boolean;
  consecutiveFaults: number;
  trippedAt: number;
}

interface CacheEntry {
  price: Price;
  cachedAt: number;
}

/** Absolute deviation between two prices in basis points of `previous`. */
export function deviationBps(previous: number, current: number): number {
  if (previous === 0) return 0;
  return Math.round((Math.abs(current - previous) / Math.abs(previous)) * 10_000);
}

export function isStale(now: number, observedAt: number, maxStalenessSecs: number): boolean {
  return now - observedAt > maxStalenessSecs;
}

export class PriceService {
  private feeds = new Map<string, FeedConfig>();
  private circuits = new Map<string, CircuitState>();
  private cache = new Map<string, CacheEntry>();
  private lastSeen = new Map<string, Price>();
  private alertListeners: DeviationAlert[] = [];

  /** Current wall-clock in unix seconds; overridable for tests. */
  now: () => number = () => Math.floor(Date.now() / 1000);

  private static key(token: string, quote: string): string {
    return `${token}/${quote}`;
  }

  /** Registers (or replaces) a feed for a `token/quote` pair. */
  registerFeed(token: string, quote: string, config: FeedConfig): void {
    const key = PriceService.key(token, quote);
    this.feeds.set(key, config);
    this.circuits.set(key, { tripped: false, consecutiveFaults: 0, trippedAt: 0 });
  }

  onDeviation(listener: DeviationAlert): void {
    this.alertListeners.push(listener);
  }

  /**
   * Returns the freshest valid price for a pair, falling back to the secondary
   * feed when the primary is stale or missing. Faults feed the circuit breaker.
   */
  async getPrice(token: string, quote: string): Promise<Price> {
    const key = PriceService.key(token, quote);
    const config = this.feeds.get(key);
    if (!config) {
      throw new PriceServiceError('FEED_NOT_FOUND', `No feed registered for ${key}`);
    }
    const now = this.now();
    const circuit = this.circuits.get(key)!;

    if (circuit.tripped) {
      if (now - circuit.trippedAt < CIRCUIT_COOLDOWN_SECS) {
        throw new PriceServiceError('CIRCUIT_OPEN', `Circuit open for ${key}`);
      }
      // Cooldown elapsed: half-open and let this read probe the feed.
      this.resetCircuit(token, quote);
    }

    const [primary, fallback] = await Promise.all([
      this.safeFetch(config.primary, token, quote),
      config.fallback ? this.safeFetch(config.fallback, token, quote) : Promise.resolve(null),
    ]);
    const hadAny = primary != null || fallback != null;

    const selected = this.select(now, config.maxStalenessSecs, primary, fallback);
    if (!selected) {
      this.recordFault(key);
      throw new PriceServiceError(
        hadAny ? 'STALE_PRICE' : 'NO_PRICE_AVAILABLE',
        `No usable price for ${key}`,
      );
    }

    this.checkDeviation(key, token, quote, config.deviationThresholdBps, selected);
    this.clearFaults(key);
    return selected;
  }

  /** Like {@link getPrice} but serves a cached value within the feed's TTL. */
  async getPriceWithCache(token: string, quote: string, ttlSecs?: number): Promise<Price> {
    const key = PriceService.key(token, quote);
    const config = this.feeds.get(key);
    if (!config) {
      throw new PriceServiceError('FEED_NOT_FOUND', `No feed registered for ${key}`);
    }
    const ttl = ttlSecs ?? config.cacheTtlSecs;
    const now = this.now();
    const entry = this.cache.get(key);
    if (entry && now - entry.cachedAt <= ttl) {
      return entry.price;
    }
    const price = await this.getPrice(token, quote);
    this.cache.set(key, { price, cachedAt: now });
    return price;
  }

  getCircuitState(token: string, quote: string): CircuitState | undefined {
    return this.circuits.get(PriceService.key(token, quote));
  }

  resetCircuit(token: string, quote: string): void {
    this.circuits.set(PriceService.key(token, quote), {
      tripped: false,
      consecutiveFaults: 0,
      trippedAt: 0,
    });
  }

  // ---- internals --------------------------------------------------------

  private async safeFetch(feed: PriceFeed, token: string, quote: string): Promise<Price | null> {
    try {
      return await feed.getPrice(token, quote);
    } catch {
      // A throwing feed counts as unavailable; staleness/selection handles it.
      return null;
    }
  }

  private select(
    now: number,
    maxStalenessSecs: number,
    primary: Price | null,
    fallback: Price | null,
  ): Price | null {
    if (primary && !isStale(now, primary.timestamp, maxStalenessSecs)) return primary;
    if (fallback && !isStale(now, fallback.timestamp, maxStalenessSecs)) return fallback;
    return null;
  }

  private checkDeviation(
    key: string,
    token: string,
    quote: string,
    thresholdBps: number,
    current: Price,
  ): void {
    const previous = this.lastSeen.get(key);
    if (previous) {
      const dev = deviationBps(previous.value, current.value);
      if (dev > thresholdBps) {
        for (const listener of this.alertListeners) {
          listener({ token, quote, previous: previous.value, current: current.value, deviationBps: dev });
        }
        this.recordFault(key);
      }
    }
    this.lastSeen.set(key, current);
  }

  private recordFault(key: string): void {
    const circuit = this.circuits.get(key)!;
    circuit.consecutiveFaults += 1;
    if (circuit.consecutiveFaults >= CIRCUIT_FAULT_LIMIT && !circuit.tripped) {
      circuit.tripped = true;
      circuit.trippedAt = this.now();
    }
  }

  private clearFaults(key: string): void {
    const circuit = this.circuits.get(key)!;
    circuit.consecutiveFaults = 0;
  }
}

export const priceService = new PriceService();
