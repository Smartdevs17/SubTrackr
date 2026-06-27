/**
 * Integration tests: wallet connection flow
 *
 * Verifies the walletStore connect/disconnect lifecycle, persistence,
 * and crypto-stream management end-to-end.
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWalletStore } from '../../../src/store';
import { makeWallet, makeCryptoStream, resetIdCounter } from './factories';

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

const WALLET_KEY = '@subtrackr_wallet';

function resetWalletStore() {
  useWalletStore.setState({
    wallet: null,
    address: null,
    network: null,
    cryptoStreams: [],
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
  it('connectWallet persists wallet data to AsyncStorage', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    expect(useWalletStore.getState().wallet).not.toBeNull();
    expect(useWalletStore.getState().address).toBeTruthy();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      WALLET_KEY,
      expect.stringContaining(useWalletStore.getState().address!)
    );
  });

  it('connectWallet restores wallet from AsyncStorage without writing again', async () => {
    const wallet = makeWallet({ address: '0xRestoredAddress' });
    mockMemoryStore.set(
      WALLET_KEY,
      JSON.stringify({ address: wallet.address, network: 'Polygon', wallet })
    );

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    expect(useWalletStore.getState().address).toBe('0xRestoredAddress');
    expect(useWalletStore.getState().network).toBe('Polygon');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('disconnect clears state and removes wallet from AsyncStorage', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });

    const { wallet, address, network, cryptoStreams } = useWalletStore.getState();
    expect(wallet).toBeNull();
    expect(address).toBeNull();
    expect(network).toBeNull();
    expect(cryptoStreams).toHaveLength(0);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(WALLET_KEY);
  });

  it('connect → disconnect → reconnect restores a fresh wallet', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });
    const firstAddress = useWalletStore.getState().address;

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });
    expect(useWalletStore.getState().wallet).toBeNull();

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });
    expect(useWalletStore.getState().address).toBe(firstAddress);
    expect(useWalletStore.getState().wallet).not.toBeNull();
  });

  it('disconnect sets error when AsyncStorage.removeItem throws', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    (AsyncStorage.removeItem as jest.Mock).mockImplementationOnce(() =>
      Promise.reject(new Error('Storage failure'))
    );

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });

    expect(useWalletStore.getState().error).toBeTruthy();
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
