import { ChainType } from '../types/wallet';

/**
 * Public RPC endpoints for read-only calls and Superfluid Framework initialization.
 * Keep aligned with `App.tsx` chain definitions.
 */
export const EVM_RPC_URLS: Record<number, string> = {
  1: 'https://cloudflare-eth.com',
  137: 'https://polygon-rpc.com',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  8453: 'https://mainnet.base.org',
};

export function getEvmRpcUrl(chainId: number): string {
  const url = EVM_RPC_URLS[chainId];
  if (!url) {
    throw new Error(`No RPC configured for chain ${chainId}`);
  }
  return url;
}

/**
 * Stellar (Soroban) network configuration.
 */
export interface StellarNetworkConfig {
  name: string;
  networkPassphrase: string;
  horizonUrl: string;
  sorobanRpcUrl: string;
  nativeAsset: string;
}

export const STELLAR_NETWORKS: Record<string, StellarNetworkConfig> = {
  mainnet: {
    name: 'Stellar Mainnet',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    horizonUrl: 'https://horizon.stellar.org',
    sorobanRpcUrl: 'https://soroban-rpc.stellar.org',
    nativeAsset: 'XLM',
  },
  testnet: {
    name: 'Stellar Testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    nativeAsset: 'XLM',
  },
  futurenet: {
    name: 'Stellar Futurenet',
    networkPassphrase: 'Test SDF Future Network ; October 2022',
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    sorobanRpcUrl: 'https://rpc-futurenet.stellar.org',
    nativeAsset: 'XLM',
  },
};

export function getStellarNetworkConfig(network: string): StellarNetworkConfig {
  const config = STELLAR_NETWORKS[network];
  if (!config) {
    throw new Error(`No Stellar network config for ${network}`);
  }
  return config;
}

export function getDefaultStellarNetwork(): StellarNetworkConfig {
  return STELLAR_NETWORKS.testnet;
}

export function getChainType(chainId: number): ChainType {
  if (chainId in EVM_RPC_URLS) {
    return ChainType.EVM;
  }
  if (chainId === 0x8000) {
    return ChainType.STELLAR;
  }
  throw new Error(`Unknown chain ID: ${chainId}`);
}
