import { act, renderHook } from '@testing-library/react-native';
import { clearPriceCache, fetchTokenPrices, getTokenPrice } from '../services/priceService';
import { useTokenPrices } from './useTokenPrices';

const mockFetchTokenPrices = fetchTokenPrices as jest.MockedFunction<typeof fetchTokenPrices>;
const mockGetTokenPrice = getTokenPrice as jest.MockedFunction<typeof getTokenPrice>;
const mockClearPriceCache = clearPriceCache as jest.MockedFunction<typeof clearPriceCache>;

jest.mock('../services/priceService', () => ({
  TICKER_TO_COINGECKO_ID: {
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
  },
  fetchTokenPrices: jest.fn(),
  getTokenPrice: jest.fn(),
  clearPriceCache: jest.fn(),
}));

function createPrice(id: string, usd: number, usd24hChange: number, available = true) {
  return {
    id,
    usd,
    usd24hChange,
    fetchedAt: 1_000,
    available,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockClearPriceCache.mockClear();
  mockGetTokenPrice.mockReturnValue(null);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('useTokenPrices', () => {
  it('returns isLoading true on initial mount before fetch resolves', async () => {
    let resolveFetch!: (value: Awaited<ReturnType<typeof fetchTokenPrices>>) => void;
    mockFetchTokenPrices.mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<typeof fetchTokenPrices>>>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const { result } = renderHook(() => useTokenPrices({ tokenIds: ['BTC'] }));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.prices).toEqual({});

    await act(async () => {
      resolveFetch({
        prices: {
          bitcoin: createPrice('bitcoin', 67000, 2.35),
        },
        fromCache: false,
        error: null,
      });
      await flushPromises();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.prices.bitcoin.usd).toBe(67000);
    expect(result.current.error).toBeNull();
  });

  it('returns prices and isLoading false after fetch resolves', async () => {
    mockFetchTokenPrices.mockResolvedValueOnce({
      prices: {
        bitcoin: createPrice('bitcoin', 67000, 2.35),
      },
      fromCache: false,
      error: null,
    });

    const { result } = renderHook(() => useTokenPrices({ tokenIds: ['BTC'] }));

    await act(async () => {
      await flushPromises();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.prices.bitcoin).toMatchObject({
      id: 'bitcoin',
      usd: 67000,
      usd24hChange: 2.35,
      available: true,
    });
  });

  it('sets up an interval and re-fetches after refreshIntervalMs', async () => {
    let resolveRefresh!: (value: Awaited<ReturnType<typeof fetchTokenPrices>>) => void;
    mockFetchTokenPrices
      .mockResolvedValueOnce({
        prices: {
          bitcoin: createPrice('bitcoin', 67000, 2.35),
        },
        fromCache: false,
        error: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise<Awaited<ReturnType<typeof fetchTokenPrices>>>((resolve) => {
            resolveRefresh = resolve;
          })
      );

    const { result } = renderHook(() =>
      useTokenPrices({ tokenIds: ['BTC'], refreshIntervalMs: 60_000 })
    );

    await act(async () => {
      await flushPromises();
    });

    expect(mockFetchTokenPrices).toHaveBeenCalledTimes(1);
    expect(result.current.prices.bitcoin.usd).toBe(67000);

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(mockFetchTokenPrices).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRefresh({
        prices: {
          bitcoin: createPrice('bitcoin', 68000, 1.1),
        },
        fromCache: false,
        error: null,
      });
      await flushPromises();
    });

    expect(result.current.prices.bitcoin.usd).toBe(68000);
  });

  it('cleans up interval on unmount', async () => {
    mockFetchTokenPrices.mockResolvedValueOnce({
      prices: {
        bitcoin: createPrice('bitcoin', 67000, 2.35),
      },
      fromCache: false,
      error: null,
    });
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    const { unmount } = renderHook(() => useTokenPrices({ tokenIds: ['BTC'] }));

    await act(async () => {
      await flushPromises();
    });

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('sets isRefreshing true during manual refresh and false after', async () => {
    let resolveRefresh!: (value: Awaited<ReturnType<typeof fetchTokenPrices>>) => void;
    mockFetchTokenPrices
      .mockResolvedValueOnce({
        prices: {
          bitcoin: createPrice('bitcoin', 67000, 2.35),
        },
        fromCache: false,
        error: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise<Awaited<ReturnType<typeof fetchTokenPrices>>>((resolve) => {
            resolveRefresh = resolve;
          })
      );

    const { result } = renderHook(() => useTokenPrices({ tokenIds: ['BTC'] }));

    await act(async () => {
      await flushPromises();
    });

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });

    expect(result.current.isRefreshing).toBe(true);

    await act(async () => {
      resolveRefresh({
        prices: {
          bitcoin: createPrice('bitcoin', 68000, 1.1),
        },
        fromCache: false,
        error: null,
      });
      await refreshPromise;
      await flushPromises();
    });

    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.prices.bitcoin.usd).toBe(68000);
  });

  it('returns an error when fetch fails', async () => {
    mockFetchTokenPrices.mockResolvedValueOnce({
      prices: {
        bitcoin: createPrice('bitcoin', 0, 0, false),
      },
      fromCache: true,
      error: 'Unable to load prices',
    });

    const { result } = renderHook(() => useTokenPrices({ tokenIds: ['BTC'] }));

    await act(async () => {
      await flushPromises();
    });

    expect(result.current.error).toBe('Unable to load prices');
    expect(result.current.prices.bitcoin.usd).toBe(0);
    expect(result.current.prices.bitcoin.available).toBe(false);
  });

  it('does not fetch when enabled is false', () => {
    const { result } = renderHook(() => useTokenPrices({ tokenIds: ['BTC'], enabled: false }));

    expect(mockFetchTokenPrices).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.prices).toEqual({});
  });
});
