import AsyncStorage from '@react-native-async-storage/async-storage';

import { WALLETCONNECT_CHAINS, WALLETCONNECT_PROJECT_METADATA } from './chains';
import { WalletConnectSessionState, WalletConnectSessionStatus } from './types';

const WALLETCONNECT_SESSION_KEY = '@subtrackr_walletconnect_v2_session';

function nowIso(): string {
  return new Date().toISOString();
}

function buildSessionTopic(address: string, chainId: number): string {
  return `wc-v2:${chainId}:${address.toLowerCase()}`;
}

export function buildPairingUri(address?: string | null, chainId?: number | null): string {
  const payload = {
    version: 2,
    app: WALLETCONNECT_PROJECT_METADATA.name,
    redirect: WALLETCONNECT_PROJECT_METADATA.redirect.native,
    supportedChains: WALLETCONNECT_CHAINS.map((chain) => chain.caipNetworkId),
    address: address ?? null,
    chainId: chainId ?? null,
  };

  return `subtrackr://walletconnect?payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

function createDefaultState(
  status: WalletConnectSessionStatus = 'idle'
): WalletConnectSessionState {
  return {
    status,
    address: null,
    chainId: null,
    supportedChainIds: WALLETCONNECT_CHAINS.map((chain) => chain.chainId),
    connectedAt: null,
    lastUpdatedAt: nowIso(),
    pairingUri: buildPairingUri(),
    sessionTopic: null,
    lastError: null,
    disconnectReason: null,
  };
}

class WalletConnectSessionManager {
  async restore(): Promise<WalletConnectSessionState> {
    const raw = await AsyncStorage.getItem(WALLETCONNECT_SESSION_KEY);
    if (!raw) {
      return createDefaultState();
    }

    try {
      return JSON.parse(raw) as WalletConnectSessionState;
    } catch {
      const fallback = createDefaultState('error');
      fallback.lastError = 'session_restore_failed';
      await this.persist(fallback);
      return fallback;
    }
  }

  async markConnecting(): Promise<WalletConnectSessionState> {
    const state = createDefaultState('connecting');
    state.pairingUri = buildPairingUri();
    return this.persist(state);
  }

  async markConnected(address: string, chainId: number): Promise<WalletConnectSessionState> {
    const state = createDefaultState('connected');
    state.address = address;
    state.chainId = chainId;
    state.connectedAt = nowIso();
    state.lastUpdatedAt = nowIso();
    state.pairingUri = buildPairingUri(address, chainId);
    state.sessionTopic = buildSessionTopic(address, chainId);
    return this.persist(state);
  }

  async markDisconnected(reason = 'user_disconnected'): Promise<WalletConnectSessionState> {
    const state = createDefaultState('disconnected');
    state.disconnectReason = reason;
    return this.persist(state);
  }

  async markError(message: string): Promise<WalletConnectSessionState> {
    const state = createDefaultState('error');
    state.lastError = message;
    return this.persist(state);
  }

  private async persist(state: WalletConnectSessionState): Promise<WalletConnectSessionState> {
    await AsyncStorage.setItem(WALLETCONNECT_SESSION_KEY, JSON.stringify(state));
    return state;
  }
}

export const walletConnectSessionManager = new WalletConnectSessionManager();
