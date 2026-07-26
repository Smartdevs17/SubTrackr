import { EVM_RPC_URLS } from '../../config/evm';
import { WalletConnectChainDefinition } from './types';

export const WALLETCONNECT_PROJECT_METADATA = {
  name: 'SubTrackr',
  description: 'Subscription Management with Crypto Payments',
  url: 'https://subtrackr.app',
  icons: ['https://subtrackr.app/icon.png'],
  redirect: {
    native: 'subtrackr://',
  },
};

export const WALLETCONNECT_CHAINS: WalletConnectChainDefinition[] = [
  {
    chainId: 1,
    caipNetworkId: 'eip155:1',
    name: 'Ethereum',
    currency: 'ETH',
    explorerUrl: 'https://etherscan.io',
    rpcUrl: EVM_RPC_URLS[1],
    accentColor: '#627EEA',
    description: 'Mainnet liquidity and broad wallet support',
  },
  {
    chainId: 137,
    caipNetworkId: 'eip155:137',
    name: 'Polygon',
    currency: 'MATIC',
    explorerUrl: 'https://polygonscan.com',
    rpcUrl: EVM_RPC_URLS[137],
    accentColor: '#8247E5',
    description: 'Low-fee payments and fast confirmations',
  },
  {
    chainId: 42161,
    caipNetworkId: 'eip155:42161',
    name: 'Arbitrum',
    currency: 'ETH',
    explorerUrl: 'https://arbiscan.io',
    rpcUrl: EVM_RPC_URLS[42161],
    accentColor: '#28A0F0',
    description: 'Ethereum-compatible L2 with low latency',
  },
  {
    chainId: 10,
    caipNetworkId: 'eip155:10',
    name: 'Optimism',
    currency: 'ETH',
    explorerUrl: 'https://optimistic.etherscan.io',
    rpcUrl: EVM_RPC_URLS[10],
    accentColor: '#FF0420',
    description: 'Superchain-compatible settlement path',
  },
  {
    chainId: 8453,
    caipNetworkId: 'eip155:8453',
    name: 'Base',
    currency: 'ETH',
    explorerUrl: 'https://basescan.org',
    rpcUrl: EVM_RPC_URLS[8453],
    accentColor: '#0052FF',
    description: 'Low-cost Coinbase ecosystem support',
  },
];

export const WALLETCONNECT_APP_CHAINS = WALLETCONNECT_CHAINS.map((chain) => ({
  chainId: chain.chainId,
  name: chain.name,
  currency: chain.currency,
  explorerUrl: chain.explorerUrl,
  rpcUrl: chain.rpcUrl,
}));

export function getWalletConnectChain(chainId: number): WalletConnectChainDefinition | undefined {
  return WALLETCONNECT_CHAINS.find((chain) => chain.chainId === chainId);
}
