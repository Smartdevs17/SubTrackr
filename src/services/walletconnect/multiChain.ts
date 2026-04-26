import { WALLETCONNECT_CHAINS, getWalletConnectChain } from './chains';
import type { WalletConnectChainDefinition } from './types';

export interface ChainSwitchResult {
  success: boolean;
  chainId: number;
  chain: WalletConnectChainDefinition | undefined;
  error?: string;
}

export interface MultiChainState {
  activeChainId: number;
  supportedChainIds: number[];
  chains: WalletConnectChainDefinition[];
}

export function buildMultiChainState(activeChainId: number): MultiChainState {
  return {
    activeChainId,
    supportedChainIds: WALLETCONNECT_CHAINS.map((c) => c.chainId),
    chains: WALLETCONNECT_CHAINS.map((c) => ({ ...c })),
  };
}

export function switchChain(state: MultiChainState, targetChainId: number): ChainSwitchResult {
  if (!state.supportedChainIds.includes(targetChainId)) {
    return {
      success: false,
      chainId: state.activeChainId,
      chain: getWalletConnectChain(state.activeChainId),
      error: `chain_not_supported:${targetChainId}`,
    };
  }

  return {
    success: true,
    chainId: targetChainId,
    chain: getWalletConnectChain(targetChainId),
  };
}

export function getActiveChain(state: MultiChainState): WalletConnectChainDefinition | undefined {
  return getWalletConnectChain(state.activeChainId);
}

export function isChainSupported(chainId: number): boolean {
  return WALLETCONNECT_CHAINS.some((c) => c.chainId === chainId);
}

export function getCaipNetworkId(chainId: number): string | undefined {
  return getWalletConnectChain(chainId)?.caipNetworkId;
}
