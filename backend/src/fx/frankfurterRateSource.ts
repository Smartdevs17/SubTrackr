import { FXProviderError, InvalidCurrencyCodeError } from './errors';
import type { CurrencyCode, FXRateSnapshot, FXRateSource } from './types';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';
const DEFAULT_TIMEOUT_MS = 5_000;

export interface FrankfurterRateSourceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface FrankfurterResponse {
  base: unknown;
  date: unknown;
  rates: unknown;
}

function assertCurrencyCode(currency: string): void {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new InvalidCurrencyCodeError(`Currency code must be a three-letter uppercase code: ${currency}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSnapshotDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseResponse(payload: unknown, requestedBase: CurrencyCode): FXRateSnapshot {
  if (!isRecord(payload)) {
    throw new FXProviderError('Frankfurter returned an invalid response');
  }

  const response = payload as FrankfurterResponse;
  if (response.base !== requestedBase || !isSnapshotDate(response.date) || !isRecord(response.rates)) {
    throw new FXProviderError('Frankfurter returned an invalid or mismatched rate snapshot');
  }

  const rates: Record<CurrencyCode, number> = {};
  for (const [currency, rate] of Object.entries(response.rates)) {
    if (!/^[A-Z]{3}$/.test(currency) || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new FXProviderError('Frankfurter returned an invalid exchange rate');
    }
    rates[currency] = rate;
  }

  if (Object.keys(rates).length === 0) {
    throw new FXProviderError('Frankfurter returned an empty rate snapshot');
  }

  return {
    baseCurrency: requestedBase,
    rates: Object.freeze(rates),
    snapshotDate: response.date,
    source: 'frankfurter',
  };
}

export class FrankfurterRateSource implements FXRateSource {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: FrankfurterRateSourceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive finite number');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('A fetch implementation is required');
    }
  }

  async fetchLatestSnapshot(baseCurrency: CurrencyCode): Promise<FXRateSnapshot> {
    assertCurrencyCode(baseCurrency);

    const url = new URL(FRANKFURTER_URL);
    url.searchParams.set('from', baseCurrency);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new FXProviderError(`Frankfurter request failed with HTTP ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new FXProviderError('Frankfurter returned invalid JSON');
      }
      return parseResponse(payload, baseCurrency);
    } catch (error) {
      if (error instanceof FXProviderError || error instanceof InvalidCurrencyCodeError) {
        throw error;
      }
      throw new FXProviderError('Unable to fetch the Frankfurter rate snapshot');
    } finally {
      clearTimeout(timeout);
    }
  }
}
