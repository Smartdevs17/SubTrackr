/**
 * mobile/src/wallet/walletConnectV2.ts
 *
 * WalletConnect v2 adapter. The SDK connector is injected so the module stays
 * free of native-side imports; the pairing URI builder is pure and validates
 * its inputs before producing a link for the QR handoff.
 */

import { isEvmAddress, isStellarPublicKey, normaliseAddress } from './addresses';
import { WalletConnectionError, toWalletError } from './errors';
import { WALLETCONNECT_METHODS } from './types';
import type { WalletAdapter, WalletSession } from './types';

export interface WalletConnectSessionPayload {
  accounts: string[];
  chainId: number | string;
  topic?: string;
}

export interface WalletConnectConnector {
  connect(options: { chains?: string[]; methods?: string[] }): Promise<WalletConnectSessionPayload>;
  disconnect(options?: { topic?: string; reason?: string }): Promise<void>;
  getSession?(): Promise<WalletConnectSessionPayload | null>;
}

export interface PairingUriOptions {
  topic: string;
  symKey: string;
  relayProtocol?: string;
  chains?: string[];
}

export interface WalletConnectV2AdapterOptions {
  connector: WalletConnectConnector;
  chains?: string[];
  methods?: string[];
  topic?: string;
  now?: () => number;
  onSessionChange?: (session: WalletSession | null) => void;
}

export const DEFAULT_WALLETCONNECT_CHAINS = ['eip155:1', 'eip155:137', 'stellar:pubnet'];

const HEX_64 = /^[0-9a-fA-F]{64}$/;

export function buildPairingUri(options: PairingUriOptions): string {
  if (!HEX_64.test(options.topic)) {
    throw new WalletConnectionError('INVALID_SESSION', 'Pairing topic must be 32 bytes of hex');
  }
  if (!HEX_64.test(options.symKey)) {
    throw new WalletConnectionError('INVALID_SESSION', 'Pairing symKey must be 32 bytes of hex');
  }
  const parts = [
    `relay-protocol=${encodeURIComponent(options.relayProtocol ?? 'irn')}`,
    `symKey=${encodeURIComponent(options.symKey)}`,
  ];
  if (options.chains && options.chains.length > 0) {
    parts.push(`chains=${encodeURIComponent(options.chains.join(','))}`);
  }
  return `wc:${options.topic}@2?${parts.join('&')}`;
}

export function isValidPairingUri(uri: string): boolean {
  if (typeof uri !== 'string') return false;
  return /^wc:[0-9a-fA-F]{64}@2\?/.test(uri);
}

function toSession(payload: WalletConnectSessionPayload, now: () => number): WalletSession {
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const address = normaliseAddress(String(accounts[0] ?? ''));
  let network: 'stellar' | 'evm' | null = null;
  if (isEvmAddress(address)) network = 'evm';
  else if (isStellarPublicKey(address)) network = 'stellar';
  if (!network) {
    throw new WalletConnectionError(
      'INVALID_ADDRESS',
      'WalletConnect returned no supported account'
    );
  }
  return {
    kind: 'walletconnect-v2',
    account: {
      address,
      network,
      chainId: payload.chainId,
      ...(network === 'stellar' ? { publicKey: address } : {}),
    },
    connectedAt: now(),
    ...(payload.topic ? { pairingTopic: payload.topic } : {}),
  };
}

export function createWalletConnectV2Adapter(
  options: WalletConnectV2AdapterOptions
): WalletAdapter {
  const now = options.now ?? Date.now;

  const notify = (session: WalletSession | null): void => {
    options.onSessionChange?.(session);
  };

  return {
    kind: 'walletconnect-v2',

    async connect(request): Promise<WalletSession> {
      try {
        const payload = await options.connector.connect({
          chains: request?.chains ?? options.chains ?? DEFAULT_WALLETCONNECT_CHAINS,
          methods: request?.methods ?? options.methods ?? WALLETCONNECT_METHODS,
        });
        const session = toSession(payload, now);
        notify(session);
        return session;
      } catch (error) {
        throw toWalletError(error);
      }
    },

    async disconnect(): Promise<void> {
      try {
        await options.connector.disconnect({
          ...(options.topic ? { topic: options.topic } : {}),
          reason: 'user_disconnected',
        });
        notify(null);
      } catch (error) {
        throw toWalletError(error, 'DISCONNECT_FAILED');
      }
    },

    async restore(session: WalletSession): Promise<WalletSession | null> {
      if (session.kind !== 'walletconnect-v2' || !session.account?.address) return null;
      try {
        const payload = await options.connector.getSession?.();
        if (payload === null) {
          notify(null);
          return null;
        }
        if (payload && Array.isArray(payload.accounts) && payload.accounts.length > 0) {
          const addresses = payload.accounts.map((account) => normaliseAddress(String(account)));
          if (!addresses.includes(session.account.address)) return null;
        }
        return session;
      } catch (error) {
        throw toWalletError(error, 'INVALID_SESSION');
      }
    },
  };
}
