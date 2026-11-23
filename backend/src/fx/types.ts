export type CurrencyCode = string;

export interface FXRateSnapshot {
  baseCurrency: CurrencyCode;
  rates: Readonly<Record<CurrencyCode, number>>;
  snapshotDate: string;
  source: string;
}

export interface CachedFXRateSnapshot extends FXRateSnapshot {
  stale: boolean;
}

export interface FXRateSource {
  fetchLatestSnapshot(baseCurrency: CurrencyCode): Promise<FXRateSnapshot>;
}

export interface FXConversionResult {
  originalAmount: number;
  originalCurrency: CurrencyCode;
  convertedAmount: number;
  targetCurrency: CurrencyCode;
  exchangeRate: number;
  snapshotDate: string;
  source: string;
  stale: boolean;
}
