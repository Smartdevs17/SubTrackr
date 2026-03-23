import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppNavigator } from './src/navigation/AppNavigator';

// Import WalletConnect compatibility layer
import '@walletconnect/react-native-compat';

import { createAppKit, defaultConfig, AppKit } from '@reown/appkit-ethers-react-native';

import { EVM_RPC_URLS } from './src/config/evm';

// Get projectId from environment variable
const projectId = process.env.WALLET_CONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';

// Create metadata
const metadata = {
  name: 'SubTrackr',
  description: 'Subscription Management with Crypto Payments',
  url: 'https://subtrackr.app',
  icons: ['https://subtrackr.app/icon.png'],
  redirect: {
    native: 'subtrackr://',
  },
};

const config = defaultConfig({ metadata });

// Define supported chains
const mainnet = {
  chainId: 1,
  name: 'Ethereum',
  currency: 'ETH',
  explorerUrl: 'https://etherscan.io',
  rpcUrl: EVM_RPC_URLS[1],
};

const polygon = {
  chainId: 137,
  name: 'Polygon',
  currency: 'MATIC',
  explorerUrl: 'https://polygonscan.com',
  rpcUrl: EVM_RPC_URLS[137],
};

const arbitrum = {
  chainId: 42161,
  name: 'Arbitrum',
  currency: 'ETH',
  explorerUrl: 'https://arbiscan.io',
  rpcUrl: EVM_RPC_URLS[42161],
};

const chains = [mainnet, polygon, arbitrum];

// Create AppKit
createAppKit({
  projectId,
  metadata,
  chains,
  config,
  enableAnalytics: true,
});

export default function App() {
  return (
    <>
      <StatusBar style="light" />
      <AppNavigator />
      <AppKit />
    </>
  );
}
