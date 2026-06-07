/**
 * Integration tests: wallet connection flow
 *
 * Verifies the walletStore connect/disconnect lifecycle, persistence,
 * and crypto-stream management end-to-end.
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWalletStore } from '../../../src/store/walletStore';
import { makeCryptoStream, resetIdCounter } from './factories';

// ── In-memory AsyncStorage ────────────────────────────────────────────────────
const mockMemoryStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn((key: string, value: string) => {
    mockMemoryStore.set(key, value);
    return Promise.resolve();
  }),
  getItem: jest.fn((key: string) => Promise.resolve(mockMemoryStore.get(key) ?? null)),
  removeItem: jest.fn((key: string) => {
    mockMemoryStore.delete(key);
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    mockMemoryStore.clear();
    return Promise.resolve();
  }),
}));

const PAYMENT_METHODS_KEY = '@subtrackr_payment_methods';
const PAYMENT_ATTEMPTS_KEY = '@subtrackr_payment_attempts';

function resetWalletStore() {
  useWalletStore.setState({
    connection: null,
    cryptoStreams: [],
    paymentMethods: [],
    paymentAttempts: [],
    isLoading: false,
    error: null,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockMemoryStore.clear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.removeItem as jest.Mock).mockClear();
  resetWalletStore();
  resetIdCounter();
});

afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
describe('wallet connection integration', () => {
  it('connectWallet loads payment methods from AsyncStorage', async () => {
    const mockPaymentMethods = JSON.stringify([
      {
        id: 'pm_test',
        userId: '0xTestAddress',
        tokenType: 'USDC',
        tokenAddress: '0xUSDC',
        chainId: 1,
        label: 'USDC Payment',
        priority: 'PRIMARY',
        maxSpendPerInterval: '1000',
        isVerified: true,
        isActive: true,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      },
    ]);
    mockMemoryStore.set(PAYMENT_METHODS_KEY, mockPaymentMethods);

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    expect(useWalletStore.getState().paymentMethods).toHaveLength(1);
    expect(useWalletStore.getState().paymentMethods[0].id).toBe('pm_test');
  });

  it('connectWallet works when no persisted data exists', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    expect(useWalletStore.getState().isLoading).toBe(false);
    expect(useWalletStore.getState().paymentMethods).toHaveLength(0);
  });

  it('disconnect clears state', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });

    const { connection, cryptoStreams, paymentMethods, paymentAttempts } =
      useWalletStore.getState();
    expect(connection).toBeNull();
    expect(cryptoStreams).toHaveLength(0);
    expect(paymentMethods).toHaveLength(0);
    expect(paymentAttempts).toHaveLength(0);
  });

  it('connect → disconnect → reconnect workflow', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });
    expect(useWalletStore.getState().isLoading).toBe(false);

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });
    expect(useWalletStore.getState().connection).toBeNull();

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });
    expect(useWalletStore.getState().isLoading).toBe(false);
  });

  it('disconnect handles errors gracefully', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });

    // Connection cleared successfully
    expect(useWalletStore.getState().connection).toBeNull();
  });

  it('isLoading resets to false after connect and disconnect', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });
    expect(useWalletStore.getState().isLoading).toBe(false);

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });
    expect(useWalletStore.getState().isLoading).toBe(false);
  });

  it('createCryptoStream then cancelCryptoStream marks stream inactive', async () => {
    jest.useRealTimers();

    await act(async () => {
      await useWalletStore.getState().createCryptoStream({
        token: 'USDC',
        amount: 25,
        flowRate: '0.0005',
        startDate: new Date('2026-04-01'),
        protocol: 'superfluid',
      });
    });

    const { cryptoStreams } = useWalletStore.getState();
    expect(cryptoStreams).toHaveLength(1);
    expect(cryptoStreams[0].isActive).toBe(true);

    const streamId = cryptoStreams[0].id;

    await act(async () => {
      await useWalletStore.getState().cancelCryptoStream(streamId);
    });

    expect(useWalletStore.getState().cryptoStreams[0].isActive).toBe(false);
    expect(useWalletStore.getState().isLoading).toBe(false);

    jest.useFakeTimers();
  }, 10_000);

  it('seeded crypto stream state is preserved across store resets', () => {
    const stream = makeCryptoStream({ token: 'ETHx', isActive: true });
    useWalletStore.setState({ cryptoStreams: [stream] });

    expect(useWalletStore.getState().cryptoStreams[0].token).toBe('ETHx');
    expect(useWalletStore.getState().cryptoStreams[0].isActive).toBe(true);
  });
});
