/**
 * Network configuration for multi-network support.
 * Supports both EVM and Stellar networks.
 */

export interface Network {
  id: string;
  name: string;
  type: 'evm' | 'stellar';
  rpcUrl?: string;
  chainId?: number;
  networkPassphrase?: string;
  horizonUrl?: string;
  isTestnet?: boolean;
  isCustom?: boolean;
}

// EVM Networks (existing)
export const EVM_NETWORKS: Network[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    type: 'evm',
    rpcUrl: 'https://cloudflare-eth.com',
    chainId: 1,
    isTestnet: false,
  },
  {
    id: 'polygon',
    name: 'Polygon',
    type: 'evm',
    rpcUrl: 'https://polygon-rpc.com',
    chainId: 137,
    isTestnet: false,
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    type: 'evm',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    chainId: 42161,
    isTestnet: false,
  },
];

// Stellar Networks
export const STELLAR_NETWORKS: Network[] = [
  {
    id: 'stellar-testnet',
    name: 'Stellar Testnet',
    type: 'stellar',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    isTestnet: true,
  },
  {
    id: 'stellar-mainnet',
    name: 'Stellar Mainnet',
    type: 'stellar',
    rpcUrl: 'https://soroban.stellar.org',
    horizonUrl: 'https://horizon.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    isTestnet: false,
  },
];

// All networks
export const ALL_NETWORKS = [...EVM_NETWORKS, ...STELLAR_NETWORKS];

// Network-specific contract addresses
export interface ContractAddresses {
  proxy?: string;
  storage?: string;
  subscription?: string;
  usdc?: string;
}

export const NETWORK_CONTRACT_ADDRESSES: Record<string, ContractAddresses> = {
  'stellar-testnet': {
    // These would be populated after deployment
    proxy: process.env.STELLAR_TESTNET_PROXY_ID,
    storage: process.env.STELLAR_TESTNET_STORAGE_ID,
    subscription: process.env.STELLAR_TESTNET_SUBSCRIPTION_ID,
  },
  'stellar-mainnet': {
    proxy: process.env.STELLAR_MAINNET_PROXY_ID,
    storage: process.env.STELLAR_MAINNET_STORAGE_ID,
    subscription: process.env.STELLAR_MAINNET_SUBSCRIPTION_ID,
  },
  // EVM addresses (existing)
  ethereum: {
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  polygon: {
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  },
  arbitrum: {
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
};

export function getNetworkById(id: string): Network | undefined {
  return ALL_NETWORKS.find(network => network.id === id);
}

export function getContractAddresses(networkId: string): ContractAddresses | undefined {
  return NETWORK_CONTRACT_ADDRESSES[networkId];
}

export function isStellarNetwork(network: Network): boolean {
  return network.type === 'stellar';
}

export function isEvmNetwork(network: Network): boolean {
  return network.type === 'evm';
}