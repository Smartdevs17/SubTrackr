import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TokenPrice {
  id: string;
  usd: number;
  usd24hChange: number;
  fetchedAt: number;
  available?: boolean;
}

export interface PriceServiceResult {
  prices: Record<string, TokenPrice>;
  fromCache: boolean;
  error: string | null;
}

type CoinGeckoPriceResponse = Record<
  string,
  {
    usd?: number;
    usd_24h_change?: number;
  }
>;

const COINGECKO_API_BASE_URL = 'https://api.coingecko.com/api/v3';
export const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_STORAGE_KEY = '@subtrackr/price_cache';

export const TICKER_TO_COINGECKO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  XLM: 'stellar',
  SOL: 'solana',
  USDC: 'usd-coin',
  BNB: 'binancecoin',
  MATIC: 'polygon-ecosystem-token',
  ARB: 'arbitrum',
  DAI: 'dai',
  WBTC: 'wrapped-bitcoin',
};

const memoryCache = new Map<string, TokenPrice>();
let cacheHydrationGeneration = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clonePrice(entry: TokenPrice): TokenPrice {
  return { ...entry };
}

function isCacheValid(entry: TokenPrice): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

function normalizeTokenId(tokenId: string): string {
  const trimmed = tokenId.trim();
  if (!trimmed) {
    return '';
  }

  const mapped = TICKER_TO_COINGECKO_ID[trimmed.toUpperCase()];
  return mapped ?? trimmed.toLowerCase();
}

function normalizeTokenIds(tokenIds: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tokenId of tokenIds) {
    const resolved = normalizeTokenId(tokenId);
    if (!resolved || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    normalized.push(resolved);
  }

  return normalized;
}

function buildEmptyTokenPrice(id: string): TokenPrice {
  return {
    id,
    usd: 0,
    usd24hChange: 0,
    fetchedAt: Date.now(),
    available: false,
  };
}

function collectPrices(tokenIds: string[], includeStale = true): Record<string, TokenPrice> {
  const prices: Record<string, TokenPrice> = {};

  for (const tokenId of tokenIds) {
    const cached = memoryCache.get(tokenId);
    if (cached) {
      if (includeStale || isCacheValid(cached)) {
        prices[tokenId] = clonePrice(cached);
      }
      continue;
    }

    if (includeStale) {
      prices[tokenId] = buildEmptyTokenPrice(tokenId);
    }
  }

  return prices;
}

function collectValidCachedPrices(tokenIds: string[]): Record<string, TokenPrice> {
  const prices: Record<string, TokenPrice> = {};

  for (const tokenId of tokenIds) {
    const cached = memoryCache.get(tokenId);
    if (cached && isCacheValid(cached)) {
      prices[tokenId] = clonePrice(cached);
    }
  }

  return prices;
}

function buildFailureResult(tokenIds: string[], error: string): PriceServiceResult {
  const prices = collectPrices(tokenIds, true);
  return {
    prices,
    fromCache: true,
    error,
  };
}

async function hydrateCacheFromStorage(): Promise<void> {
  const generation = ++cacheHydrationGeneration;

  try {
    const stored = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
    if (generation !== cacheHydrationGeneration || !stored) {
      return;
    }

    const parsed = JSON.parse(stored) as unknown;
    if (!isRecord(parsed)) {
      return;
    }

    memoryCache.clear();

    for (const [id, value] of Object.entries(parsed)) {
      if (!isRecord(value)) {
        continue;
      }

      const usd = typeof value.usd === 'number' ? value.usd : null;
      const usd24hChange =
        typeof value.usd24hChange === 'number'
          ? value.usd24hChange
          : typeof value.usd_24h_change === 'number'
            ? value.usd_24h_change
            : null;
      const fetchedAt = typeof value.fetchedAt === 'number' ? value.fetchedAt : null;

      if (usd === null || usd24hChange === null || fetchedAt === null) {
        continue;
      }

      memoryCache.set(id, {
        id,
        usd,
        usd24hChange,
        fetchedAt,
        available: value.available !== false,
      });
    }
  } catch (error) {
    console.warn('Failed to hydrate cached token prices', error);
  }
}

async function persistCache(): Promise<void> {
  try {
    const serialized = JSON.stringify(Object.fromEntries(memoryCache.entries()));
    await AsyncStorage.setItem(CACHE_STORAGE_KEY, serialized);
  } catch (error) {
    console.warn('Failed to persist cached token prices', error);
  }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  const apiKey =
    process.env.EXPO_PUBLIC_COINGECKO_API_KEY ??
    process.env.COINGECKO_API_KEY ??
    process.env.CG_DEMO_API_KEY;

  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  return headers;
}

function mapFetchErrorToMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return 'timeout';
    }

    const message = error.message.toLowerCase();
    if (message.includes('network')) {
      return 'Unable to load prices';
    }
  }

  return 'Unable to load prices';
}

export function getTokenPrice(tokenId: string): TokenPrice | null {
  const normalized = normalizeTokenId(tokenId);
  if (!normalized) {
    return null;
  }

  const cached = memoryCache.get(normalized);
  return cached ? clonePrice(cached) : null;
}

export function clearPriceCache(): void {
  memoryCache.clear();
  cacheHydrationGeneration += 1;
  void AsyncStorage.removeItem(CACHE_STORAGE_KEY);
}

export async function fetchTokenPrices(tokenIds: string[]): Promise<PriceServiceResult> {
  const normalizedIds = normalizeTokenIds(tokenIds);
  if (normalizedIds.length === 0) {
    return {
      prices: {},
      fromCache: true,
      error: null,
    };
  }

  const validCachedPrices = collectValidCachedPrices(normalizedIds);
  if (Object.keys(validCachedPrices).length === normalizedIds.length) {
    return {
      prices: validCachedPrices,
      fromCache: true,
      error: null,
    };
  }

  const idsToFetch = normalizedIds.filter((tokenId) => {
    const cached = memoryCache.get(tokenId);
    return !cached || !isCacheValid(cached);
  });

  if (idsToFetch.length === 0) {
    return {
      prices: collectPrices(normalizedIds, true),
      fromCache: true,
      error: null,
    };
  }

  const url = new URL(`${COINGECKO_API_BASE_URL}/simple/price`);
  url.searchParams.set('ids', idsToFetch.join(','));
  url.searchParams.set('vs_currencies', 'usd');
  url.searchParams.set('include_24hr_change', 'true');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: buildHeaders(),
    });

    if (response.status === 429) {
      console.warn('CoinGecko rate limited the price request');
      return buildFailureResult(normalizedIds, 'rate limited');
    }

    if (!response.ok) {
      console.warn('CoinGecko price request failed', response.status, response.statusText);
      return buildFailureResult(normalizedIds, 'Unable to load prices');
    }

    let payload: CoinGeckoPriceResponse;
    try {
      payload = (await response.json()) as CoinGeckoPriceResponse;
    } catch (error) {
      console.warn('CoinGecko price response could not be parsed', error);
      return buildFailureResult(normalizedIds, 'Unable to load prices');
    }

    if (!isRecord(payload)) {
      console.warn('CoinGecko price response had an unexpected shape');
      return buildFailureResult(normalizedIds, 'Unable to load prices');
    }

    const fetchedAt = Date.now();

    for (const tokenId of idsToFetch) {
      const entry = payload[tokenId];
      if (entry && typeof entry.usd === 'number' && typeof entry.usd_24h_change === 'number') {
        memoryCache.set(tokenId, {
          id: tokenId,
          usd: entry.usd,
          usd24hChange: entry.usd_24h_change,
          fetchedAt,
          available: true,
        });
      }
    }

    await persistCache();

    return {
      prices: collectPrices(normalizedIds, true),
      fromCache: false,
      error: null,
    };
  } catch (error) {
    const message = mapFetchErrorToMessage(error);
    console.warn('CoinGecko price request failed', error);
    return buildFailureResult(normalizedIds, message);
  } finally {
    clearTimeout(timeout);
  }
}

void hydrateCacheFromStorage();
