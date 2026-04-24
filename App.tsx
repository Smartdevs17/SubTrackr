import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useNotifications } from './src/hooks/useNotifications';
import { useTransactionQueue } from './src/hooks/useTransactionQueue';
import ErrorBoundary from './src/components/ErrorBoundary';

// Import WalletConnect compatibility layer
import '@walletconnect/react-native-compat';

import { createAppKit, defaultConfig, AppKit } from '@reown/appkit-ethers-react-native';

import { EVM_RPC_URLS } from './src/config/evm';
import { useNetworkStore } from './src/store';
import { sessionService } from './src/services/auth/session';

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

function NotificationBootstrap() {
  useNotifications();
  useTransactionQueue();

  const { initialize } = useNetworkStore();
  React.useEffect(() => {
    initialize();
    void sessionService.initializeCurrentSession();
  }, [initialize]);

  return null;
}

export default function App() {
  return (
    <View style={{ flex: 1 }} testID="app-root">
      <StatusBar style="light" />
      <ErrorBoundary>
        <NotificationBootstrap />
        <AppNavigator />
      </ErrorBoundary>
      <AppKit />
    </View>
  );
}
