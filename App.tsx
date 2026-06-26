import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useNotifications } from './src/hooks/useNotifications';
import { useTransactionQueue } from './src/hooks/useTransactionQueue';
import ErrorBoundary from './src/components/ErrorBoundary';
import { initI18n } from './src/i18n/config';
import i18n from './src/i18n/config';
import { I18nextProvider } from 'react-i18next';
import { applyE2EBootstrap } from './src/utils/e2e/e2eBootstrap';

// Import WalletConnect compatibility layer
import '@walletconnect/react-native-compat';

import { createAppKit, defaultConfig, AppKit } from '@reown/appkit-ethers-react-native';

import { EVM_RPC_URLS } from './src/config/evm';
import { useNetworkStore, useSettingsStore } from './src/store';
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
  const { initializeSettings } = useSettingsStore();

  React.useEffect(() => {
    initialize();
    void initializeSettings();
    void sessionService.initializeCurrentSession();
  }, [initialize, initializeSettings]);

  return null;
}

export default function App() {
  const [i18nReady, setI18nReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        // Hermetic E2E setup (seed data, mocked network, fixed clock). No-op in
        // production — see src/utils/e2e/e2eBootstrap.ts.
        await applyE2EBootstrap();
        await initI18n();
      } finally {
        if (!cancelled) setI18nReady(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!i18nReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1 }} testID="app-root">
        <StatusBar style="light" />
        <ErrorBoundary>
          <I18nextProvider i18n={i18n}>
            <NotificationBootstrap />
            <AppNavigator />
          </I18nextProvider>
        </ErrorBoundary>
        <AppKit />
      </View>
    </GestureHandlerRootView>
  );
}
