import { logger } from '../utils/logger';
import {
  FXRateUnavailableError,
  FXSnapshotUnavailableError,
  InvalidCurrencyCodeError,
  InvalidFXAmountError,
} from './errors';
import { FrankfurterRateSource } from './frankfurterRateSource';
import type {
  CachedFXRateSnapshot,
  CurrencyCode,
  FXConversionResult,
  FXRateSnapshot,
  FXRateSource,
} from './types';

const fxLogger = logger.child('fx');
const DEFAULT_MAX_STALE_SNAPSHOT_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export interface FXConversionServiceOptions {
  source?: FXRateSource;
  decimalPlaces?: number;
  allowStaleSnapshotOnError?: boolean;
  maxStaleSnapshotAgeMs?: number;
  now?: () => number;
}

interface SnapshotCacheEntry {
  requestDate: string;
  snapshot: FXRateSnapshot;
  stale: boolean;
}

function assertCurrencyCode(currency: CurrencyCode): void {
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    throw new InvalidCurrencyCodeError(`Currency code must be a three-letter uppercase code: ${currency}`);
  }
}

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function isSnapshotDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateSnapshot(snapshot: FXRateSnapshot, requestedBase: CurrencyCode): FXRateSnapshot {
  if (
    snapshot.baseCurrency !== requestedBase ||
    !isSnapshotDate(snapshot.snapshotDate) ||
    typeof snapshot.source !== 'string' ||
    snapshot.source.trim() === '' ||
    !snapshot.rates ||
    Object.keys(snapshot.rates).length === 0
  ) {
    throw new FXSnapshotUnavailableError('Rate source returned an invalid snapshot');
  }

  const rates: Record<CurrencyCode, number> = {};
  for (const [currency, rate] of Object.entries(snapshot.rates)) {
    assertCurrencyCode(currency);
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new FXSnapshotUnavailableError('Rate source returned an invalid exchange rate');
    }
    rates[currency] = rate;
  }

  return { ...snapshot, rates: Object.freeze(rates) };
}

export class FXConversionService {
  private readonly source: FXRateSource;
  private readonly decimalPlaces: number;
  private readonly allowStaleSnapshotOnError: boolean;
  private readonly maxStaleSnapshotAgeMs: number;
  private readonly now: () => number;
  private readonly snapshots = new Map<CurrencyCode, SnapshotCacheEntry>();
  private readonly inFlight = new Map<CurrencyCode, Promise<CachedFXRateSnapshot>>();

  constructor(options: FXConversionServiceOptions = {}) {
    this.source = options.source ?? new FrankfurterRateSource();
    this.decimalPlaces = options.decimalPlaces ?? 2;
    this.allowStaleSnapshotOnError = options.allowStaleSnapshotOnError ?? true;
    this.maxStaleSnapshotAgeMs = options.maxStaleSnapshotAgeMs ?? DEFAULT_MAX_STALE_SNAPSHOT_AGE_MS;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.decimalPlaces) || this.decimalPlaces < 0 || this.decimalPlaces > 8) {
      throw new RangeError('decimalPlaces must be an integer from 0 to 8');
    }
    if (!Number.isFinite(this.maxStaleSnapshotAgeMs) || this.maxStaleSnapshotAgeMs < 0) {
      throw new RangeError('maxStaleSnapshotAgeMs must be a non-negative finite number');
    }
  }

  async getSnapshot(baseCurrency: CurrencyCode): Promise<CachedFXRateSnapshot> {
    assertCurrencyCode(baseCurrency);
    const today = utcDate(this.now());
    const cached = this.snapshots.get(baseCurrency);
    if (cached?.requestDate === today) {
      return { ...cached.snapshot, stale: cached.stale };
    }

    const existingRequest = this.inFlight.get(baseCurrency);
    if (existingRequest) return existingRequest;

    const request = this.fetchSnapshot(baseCurrency, today, cached)
      .finally(() => this.inFlight.delete(baseCurrency));
    this.inFlight.set(baseCurrency, request);
    return request;
  }

  async convert(
    amount: number,
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
  ): Promise<FXConversionResult> {
    if (!Number.isFinite(amount)) {
      throw new InvalidFXAmountError('Amount must be a finite number');
    }
    assertCurrencyCode(fromCurrency);
    assertCurrencyCode(toCurrency);

    if (fromCurrency === toCurrency) {
      return {
        originalAmount: amount,
        originalCurrency: fromCurrency,
        convertedAmount: this.round(amount),
        targetCurrency: toCurrency,
        exchangeRate: 1,
        snapshotDate: utcDate(this.now()),
        source: 'identity',
        stale: false,
      };
    }

    const snapshot = await this.getSnapshot(fromCurrency);
    const rate = snapshot.rates[toCurrency];
    if (rate === undefined) {
      throw new FXRateUnavailableError(
        `No ${fromCurrency} to ${toCurrency} exchange rate is available in the ${snapshot.source} snapshot`,
      );
    }

    const convertedAmount = this.round(amount * rate);
    if (!Number.isFinite(convertedAmount)) {
      throw new InvalidFXAmountError('Converted amount is outside the supported numeric range');
    }

    return {
      originalAmount: amount,
      originalCurrency: fromCurrency,
      convertedAmount,
      targetCurrency: toCurrency,
      exchangeRate: rate,
      snapshotDate: snapshot.snapshotDate,
      source: snapshot.source,
      stale: snapshot.stale,
    };
  }

  private async fetchSnapshot(
    baseCurrency: CurrencyCode,
    requestDate: string,
    cached: SnapshotCacheEntry | undefined,
  ): Promise<CachedFXRateSnapshot> {
    const startedAt = this.now();
    try {
      const snapshot = validateSnapshot(
        await this.source.fetchLatestSnapshot(baseCurrency),
        baseCurrency,
      );
      if (snapshot.snapshotDate > requestDate) {
        throw new FXSnapshotUnavailableError('Rate source returned a future-dated snapshot');
      }
      this.snapshots.set(baseCurrency, { requestDate, snapshot, stale: false });
      fxLogger.info('fx.snapshot.refreshed', {
        baseCurrency,
        snapshotDate: snapshot.snapshotDate,
        source: snapshot.source,
        durationMs: Math.max(0, this.now() - startedAt),
      });
      return { ...snapshot, stale: false };
    } catch (error) {
      fxLogger.error('fx.snapshot.refresh_failed', {
        baseCurrency,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        durationMs: Math.max(0, this.now() - startedAt),
      });
      const staleAgeMs = cached
        ? Math.max(0, this.now() - Date.parse(`${cached.snapshot.snapshotDate}T00:00:00.000Z`))
        : Number.POSITIVE_INFINITY;
      if (
        cached &&
        this.allowStaleSnapshotOnError &&
        staleAgeMs <= this.maxStaleSnapshotAgeMs
      ) {
        this.snapshots.set(baseCurrency, {
          requestDate,
          snapshot: cached.snapshot,
          stale: true,
        });
        fxLogger.warn('fx.snapshot.stale_fallback', {
          baseCurrency,
          snapshotDate: cached.snapshot.snapshotDate,
          source: cached.snapshot.source,
          staleAgeMs,
        });
        return { ...cached.snapshot, stale: true };
      }
      throw new FXSnapshotUnavailableError(`Unable to load an FX snapshot for ${baseCurrency}`);
    }
  }

  private round(value: number): number {
    const factor = 10 ** this.decimalPlaces;
    const scaled = Math.abs(value) * factor;
    if (!Number.isFinite(scaled) || scaled > Number.MAX_SAFE_INTEGER) {
      throw new InvalidFXAmountError('Amount is outside the supported numeric range');
    }
    return Math.sign(value) * Math.round(scaled + Number.EPSILON) / factor;
  }
}

export const fxConversionService = new FXConversionService();
