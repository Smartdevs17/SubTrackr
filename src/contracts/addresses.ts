/**
 * Canonical EVM contract addresses by chain. Prefer these over literals in services.
 * Add new networks or contracts here as the app gains support.
 */
export const CHAIN_IDS = {
  ETHEREUM: 1,
  POLYGON: 137,
  ARBITRUM_ONE: 42161,
} as const;

export type KnownChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export type ContractKey = 'usdc';

type ChainContracts = Record<ContractKey, `0x${string}`>;

export const CONTRACT_ADDRESSES: Record<KnownChainId, ChainContracts> = {
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

const SUPPORTED = new Set<number>(Object.values(CHAIN_IDS));

export function isKnownEvmChainId(chainId: number): chainId is KnownChainId {
  return SUPPORTED.has(chainId);
}

export function getContractAddress(chainId: number, key: ContractKey): string | undefined {
  if (!isKnownEvmChainId(chainId)) return undefined;
  return CONTRACT_ADDRESSES[chainId][key];
}
