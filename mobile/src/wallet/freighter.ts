/**
 * mobile/src/wallet/freighter.ts
 *
 * Freighter (Stellar) adapter. The browser extension / injected provider is
 * resolved lazily and can be injected for tests, keeping this module safe to
 * import in a non-browser runtime.
 */

import { isStellarPublicKey, normaliseAddress } from './addresses';
import { WalletConnectionError, toWalletError } from './errors';
import type { WalletAdapter, WalletSession } from './types';

export interface FreighterProvider {
  connect?(): Promise<string | null | undefined>;
  getPublicKey?(): Promise<string | null | undefined>;
  isConnected?(): Promise<boolean>;
  getNetwork?(): Promise<string | null | undefined>;
  disconnect?(): Promise<void>;
}

interface GlobalWithFreighter {
  freighterApi?: FreighterProvider;
  freighter?: FreighterProvider;
  stellar?: FreighterProvider;
}

export interface FreighterAdapterOptions {
  provider?: FreighterProvider | null;
  now?: () => number;
}

export function resolveFreighterProvider(
  candidate?: FreighterProvider | null
): FreighterProvider | null {
  if (candidate) return candidate;
  const globalProvider = globalThis as GlobalWithFreighter;
  return globalProvider.freighterApi ?? globalProvider.freighter ?? globalProvider.stellar ?? null;
}

async function readPublicKey(provider: FreighterProvider): Promise<string> {
  let publicKey: string | null | undefined;
  try {
    publicKey = await provider.connect?.();
  } catch (error) {
    throw toWalletError(error);
  }
  if (!publicKey) {
    try {
      publicKey = await provider.getPublicKey?.();
    } catch (error) {
      throw toWalletError(error);
    }
  }
  if (!publicKey) {
    throw new WalletConnectionError('INVALID_ADDRESS', 'Freighter did not return a public key');
  }
  const address = normaliseAddress(publicKey);
  if (!isStellarPublicKey(address)) {
    throw new WalletConnectionError('INVALID_ADDRESS', 'Freighter returned an invalid Stellar key');
  }
  return address;
}

export function createFreighterAdapter(options: FreighterAdapterOptions = {}): WalletAdapter {
  const now = options.now ?? Date.now;

  return {
    kind: 'freighter',

    async connect(): Promise<WalletSession> {
      const provider = resolveFreighterProvider(options.provider);
      if (!provider) {
        throw new WalletConnectionError(
          'PROVIDER_UNAVAILABLE',
          'Freighter extension is not available',
          true
        );
      }
      const address = await readPublicKey(provider);
      let network = 'public';
      try {
        network = (await provider.getNetwork?.())?.trim() || network;
      } catch (error) {
        throw toWalletError(error);
      }
      return {
        kind: 'freighter',
        account: {
          address,
          publicKey: address,
          network: 'stellar',
          chainId: network,
        },
        connectedAt: now(),
      };
    },

    async disconnect(): Promise<void> {
      const provider = resolveFreighterProvider(options.provider);
      if (!provider?.disconnect) return;
      try {
        await provider.disconnect();
      } catch (error) {
        throw toWalletError(error, 'DISCONNECT_FAILED');
      }
    },

    async restore(session: WalletSession): Promise<WalletSession | null> {
      if (session.kind !== 'freighter' || !isStellarPublicKey(session.account?.address ?? '')) {
        return null;
      }
      const provider = resolveFreighterProvider(options.provider);
      if (!provider) return null;
      if (provider.isConnected && !(await provider.isConnected())) return null;
      return session;
    },
  };
}
