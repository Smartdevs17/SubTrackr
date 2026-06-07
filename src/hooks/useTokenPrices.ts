import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchTokenPrices,
  getTokenPrice,
  TICKER_TO_COINGECKO_ID,
  type TokenPrice,
} from '../services/priceService';

interface UseTokenPricesOptions {
  tokenIds: string[];
  refreshIntervalMs?: number;
  enabled?: boolean;
}

interface UseTokenPricesResult {
  prices: Record<string, TokenPrice>;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  fromCache: boolean;
  refresh: () => Promise<void>;
  lastUpdated: number | null;
}

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

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

function readCachedPrices(tokenIds: string[]): Record<string, TokenPrice> {
  const prices: Record<string, TokenPrice> = {};

  for (const tokenId of tokenIds) {
    const cached = getTokenPrice(tokenId);
    if (cached) {
      prices[tokenId] = cached;
    }
  }

  return prices;
}

function getLatestFetchedAt(prices: Record<string, TokenPrice>): number | null {
  const timestamps = Object.values(prices).map((price) => price.fetchedAt);
  if (timestamps.length === 0) {
    return null;
  }

  return Math.max(...timestamps);
}

export function useTokenPrices(options: UseTokenPricesOptions): UseTokenPricesResult {
  const { tokenIds, refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS, enabled = true } = options;

  const tokenIdsKey = tokenIds.join('|');
  const normalizedTokenIds = useMemo(() => normalizeTokenIds(tokenIds), [tokenIdsKey]);
  const normalizedKey = normalizedTokenIds.join('|');
  const effectiveRefreshIntervalMs = Math.max(refreshIntervalMs, DEFAULT_REFRESH_INTERVAL_MS);

  const [prices, setPrices] = useState<Record<string, TokenPrice>>(() =>
    readCachedPrices(normalizedTokenIds)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(() =>
    getLatestFetchedAt(readCachedPrices(normalizedTokenIds))
  );

  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const pricesRef = useRef<Record<string, TokenPrice>>(prices);
  const normalizedTokenIdsRef = useRef<string[]>(normalizedTokenIds);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    pricesRef.current = prices;
  }, [prices]);

  useEffect(() => {
    normalizedTokenIdsRef.current = normalizedTokenIds;
  }, [normalizedKey]);

  const runFetch = useCallback(
    async (manual = false): Promise<void> => {
      const tokens = normalizedTokenIdsRef.current;
      const requestVersion = requestVersionRef.current;

      if (!enabled || tokens.length === 0) {
        return;
      }

      if (inFlightRef.current) {
        if (manual) {
          setIsRefreshing(true);
          inFlightRef.current.finally(() => {
            if (mountedRef.current) {
              setIsRefreshing(false);
            }
          });
        }
        return inFlightRef.current;
      }

      const shouldShowLoading = Object.keys(pricesRef.current).length === 0;
      if (manual) {
        setIsRefreshing(true);
      } else if (shouldShowLoading) {
        setIsLoading(true);
      }

      const fetchPromise = (async () => {
        try {
          const result = await fetchTokenPrices(tokens);
          if (!mountedRef.current || requestVersion !== requestVersionRef.current) {
            return;
          }

          pricesRef.current = result.prices;
          setPrices(result.prices);
          setFromCache(result.fromCache);
          setError(result.error);
          setLastUpdated(getLatestFetchedAt(result.prices));
        } catch (fetchError) {
          if (!mountedRef.current) {
            return;
          }

          const message =
            fetchError instanceof Error ? fetchError.message : 'Unable to load prices';
          setError(message);
        } finally {
          if (!mountedRef.current || requestVersion !== requestVersionRef.current) {
            return;
          }

          setIsLoading(false);
          if (manual) {
            setIsRefreshing(false);
          }

          inFlightRef.current = null;
        }
      })();

      inFlightRef.current = fetchPromise;
      return fetchPromise;
    },
    [enabled, normalizedKey]
  );

  useEffect(() => {
    mountedRef.current = true;
    requestVersionRef.current += 1;
    inFlightRef.current = null;

    const cachedPrices = readCachedPrices(normalizedTokenIds);
    pricesRef.current = cachedPrices;
    normalizedTokenIdsRef.current = normalizedTokenIds;
    setPrices(cachedPrices);
    setFromCache(true);
    setError(null);
    setLastUpdated(getLatestFetchedAt(cachedPrices));

    if (!enabled || normalizedTokenIds.length === 0) {
      setIsLoading(false);
      setIsRefreshing(false);
      return () => {
        mountedRef.current = false;
      };
    }

    const hasAnyCachedData = normalizedTokenIds.some((tokenId) => getTokenPrice(tokenId) !== null);
    setIsLoading(!hasAnyCachedData);

    void runFetch(false);

    const intervalId = setInterval(() => {
      void runFetch(false);
    }, effectiveRefreshIntervalMs);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [enabled, effectiveRefreshIntervalMs, normalizedKey, runFetch, normalizedTokenIds]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || normalizedTokenIdsRef.current.length === 0) {
      return;
    }

    await runFetch(true);
  }, [enabled, normalizedKey, runFetch]);

  return {
    prices,
    isLoading,
    isRefreshing,
    error,
    fromCache,
    refresh,
    lastUpdated,
  };
}
