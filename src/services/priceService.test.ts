import {
  clearPriceCache,
  fetchTokenPrices,
  getTokenPrice,
  TICKER_TO_COINGECKO_ID,
  CACHE_TTL_MS,
} from './priceService';

type MockStorageHost = typeof globalThis & {
  __priceServiceTestStorage?: Map<string, string>;
};

function mockGetStorage(): Map<string, string> {
  const host = globalThis as MockStorageHost;
  if (!host.__priceServiceTestStorage) {
    host.__priceServiceTestStorage = new Map<string, string>();
  }
  return host.__priceServiceTestStorage;
}

const mockFetch = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockGetStorage().get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockGetStorage().set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockGetStorage().delete(key);
    return Promise.resolve();
  }),
}));

type MockResponseInit = {
  ok?: boolean;
  status?: number;
  statusText?: string;
};

function createResponse(body: unknown, init: MockResponseInit = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStorage().clear();
  clearPriceCache();
});

describe('priceService', () => {
  it('returns real prices on successful API response', async () => {
    mockFetch.mockResolvedValueOnce(
      createResponse({
        bitcoin: { usd: 67000, usd_24h_change: 2.35 },
      })
    );

    const result = await fetchTokenPrices(['BTC']);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.fromCache).toBe(false);
    expect(result.error).toBeNull();
    expect(result.prices.bitcoin).toMatchObject({
      id: 'bitcoin',
      usd: 67000,
      usd24hChange: 2.35,
      available: true,
    });
  });

  it('returns cached prices without calling fetch when cache is valid', async () => {
    mockFetch.mockResolvedValueOnce(
      createResponse({
        bitcoin: { usd: 67000, usd_24h_change: 2.35 },
      })
    );

    const first = await fetchTokenPrices(['BTC']);
    const second = await fetchTokenPrices(['BTC']);

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second.prices.bitcoin.usd).toBe(67000);
  });

  it('returns stale cache with error when fetch fails', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    mockFetch.mockResolvedValueOnce(
      createResponse({
        bitcoin: { usd: 67000, usd_24h_change: 2.35 },
      })
    );
    await fetchTokenPrices(['BTC']);

    nowSpy.mockReturnValue(1_000 + CACHE_TTL_MS + 1);
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const result = await fetchTokenPrices(['BTC']);

    expect(result.fromCache).toBe(true);
    expect(result.error).toBe('Unable to load prices');
    expect(result.prices.bitcoin.usd).toBe(67000);
    expect(result.prices.bitcoin.available).toBe(true);

    nowSpy.mockRestore();
  });

  it('returns error and empty prices when fetch fails and cache is empty', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));

    const result = await fetchTokenPrices(['BTC']);

    expect(result.fromCache).toBe(true);
    expect(result.error).toBe('Unable to load prices');
    expect(result.prices.bitcoin.usd).toBe(0);
    expect(result.prices.bitcoin.available).toBe(false);
  });

  it('handles HTTP non-200 response', async () => {
    mockFetch.mockResolvedValueOnce(
      createResponse(
        {},
        {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
        }
      )
    );

    const result = await fetchTokenPrices(['BTC']);

    expect(result.error).toBe('rate limited');
    expect(result.fromCache).toBe(true);
    expect(result.prices.bitcoin.available).toBe(false);
  });

  it('respects the 10s timeout', async () => {
    jest.useFakeTimers();
    const abortSpy = jest.spyOn(AbortController.prototype, 'abort');

    mockFetch.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const abortError = new Error('Aborted');
          (abortError as Error & { name: string }).name = 'AbortError';
          reject(abortError);
        });
      });
    });

    const promise = fetchTokenPrices(['BTC']);

    await Promise.resolve();
    jest.advanceTimersByTime(10_001);
    await Promise.resolve();

    const result = await promise;

    expect(abortSpy).toHaveBeenCalled();
    expect(result.error).toBe('timeout');
    expect(result.fromCache).toBe(true);

    abortSpy.mockRestore();
    jest.useRealTimers();
  });

  it('returns null for an unknown token', () => {
    expect(getTokenPrice('does-not-exist')).toBeNull();
  });

  it('returns cached entry for a known token', async () => {
    mockFetch.mockResolvedValueOnce(
      createResponse({
        bitcoin: { usd: 67000, usd_24h_change: 2.35 },
      })
    );

    await fetchTokenPrices(['BTC']);
    expect(getTokenPrice('bitcoin')).toMatchObject({
      id: 'bitcoin',
      usd: 67000,
      usd24hChange: 2.35,
      available: true,
    });
  });

  it('empties the cache when cleared', async () => {
    mockFetch.mockResolvedValueOnce(
      createResponse({
        bitcoin: { usd: 67000, usd_24h_change: 2.35 },
      })
    );

    await fetchTokenPrices(['BTC']);
    clearPriceCache();

    mockFetch.mockResolvedValueOnce(
      createResponse({
        bitcoin: { usd: 68000, usd_24h_change: 1.1 },
      })
    );

    await fetchTokenPrices(['BTC']);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('contains mappings for every token symbol used in the app', () => {
    expect(TICKER_TO_COINGECKO_ID).toEqual(
      expect.objectContaining({
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
      })
    );
  });
});
