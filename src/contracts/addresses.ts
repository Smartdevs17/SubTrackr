/**
 * Canonical contract addresses by network. Prefer these over literals in services.
 * Supports both EVM and Stellar networks.
 */
import { Network, getContractAddresses } from '../config/networks';

export const CHAIN_IDS = {
  ETHEREUM: 1,
  POLYGON: 137,
  ARBITRUM_ONE: 42161,
} as const;

export type KnownChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export type EVMContractKey = 'usdc';
export type StellarContractKey = 'proxy' | 'storage' | 'subscription';

type EVMChainContracts = Record<EVMContractKey, `0x${string}`>;
type StellarNetworkContracts = Record<StellarContractKey, string>;

export const EVM_CONTRACT_ADDRESSES: Record<KnownChainId, EVMChainContracts> = {
  [CHAIN_IDS.ETHEREUM]: {
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  [CHAIN_IDS.POLYGON]: {
    // Bridged USDC.e (matches historical app behavior)
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  },
  [CHAIN_IDS.ARBITRUM_ONE]: {
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
};

const SUPPORTED_EVM = new Set<number>(Object.values(CHAIN_IDS));

export function isKnownEvmChainId(chainId: number): chainId is KnownChainId {
  return SUPPORTED_EVM.has(chainId);
}

export function getEvmContractAddress(chainId: number, key: EVMContractKey): string | undefined {
  if (!isKnownEvmChainId(chainId)) return undefined;
  return EVM_CONTRACT_ADDRESSES[chainId][key];
}

export function getStellarContractAddress(networkId: string, key: StellarContractKey): string | undefined {
  const addresses = getContractAddresses(networkId);
  return addresses?.[key];
}

// Legacy compatibility
export type ContractKey = EVMContractKey;
export const CONTRACT_ADDRESSES = EVM_CONTRACT_ADDRESSES;
export function getContractAddress(chainId: number, key: ContractKey): string | undefined {
  return getEvmContractAddress(chainId, key);
}
