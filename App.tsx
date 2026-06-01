import React from 'react';
import { View, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useNotifications } from './src/hooks/useNotifications';
import { useTransactionQueue } from './src/hooks/useTransactionQueue';
import ErrorBoundary from './src/components/ErrorBoundary';
import CrashRecoveryModal from './src/components/CrashRecoveryModal';
import { initI18n } from './src/i18n/config';
import i18n from './src/i18n/config';
import { I18nextProvider } from 'react-i18next';
import { crashReporter, CrashRecord } from './src/services/crashReporter';
import * as Sentry from '@sentry/react-native';

// Validate all environment variables at startup — fails fast in production
// and warns in development/staging if any vars are missing or malformed.
import './src/config/env';

// Import WalletConnect compatibility layer
import '@walletconnect/react-native-compat';

import { createAppKit, defaultConfig, AppKit } from '@reown/appkit-ethers-react-native';

import { EVM_RPC_URLS } from './src/config/evm';
import { useNetworkStore, useSettingsStore, useWalletStore } from './src/store';
import { sessionService } from './src/services/auth/session';

// Get projectId from validated environment
const projectId = env.WALLET_CONNECT_PROJECT_ID;

// Initialize Sentry (DSN provided via env var)
try {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || '',
    enableAutoSessionTracking: true,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.05),
    environment: process.env.NODE_ENV || 'production',
  });
} catch (e) {
  // Fail gracefully if Sentry cannot initialize in some environments
  // eslint-disable-next-line no-console
  console.warn('Sentry init failed', e);
}

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

  const wallet = useWalletStore();

  const { initialize } = useNetworkStore();
  const { initializeSettings } = useSettingsStore();

  React.useEffect(() => {
    initialize();
    void initializeSettings();
    void (async () => {
      const session = await sessionService.initializeCurrentSession();
      // Attach session context to Sentry for better diagnostics
      try {
        Sentry.setContext('session', { id: session.id, deviceName: session.deviceName });
        if (wallet?.address) {
          Sentry.setUser({ id: wallet.address });
        }
      } catch (e) {
        // ignore
      }
    })();
  }, [initialize, initializeSettings]);


  return null;
}

function AppShell() {
  const { isDark, colors } = useTheme();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background.primary }}>
      <View style={{ flex: 1, backgroundColor: colors.background.primary }} testID="app-root">
        <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.background.primary} />
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

export default function App() {
  const [i18nReady, setI18nReady] = React.useState(false);
  const [pendingCrash, setPendingCrash] = React.useState<CrashRecord | null>(null);
  const [showRecoveryModal, setShowRecoveryModal] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await initI18n();

        // Initialize crash reporter — returns the previous crash if one exists
        const previousCrash = await crashReporter.initialize({
          // Preserve user settings and auth tokens across a recovery wipe
          preservedStorageKeys: [
            '@subtrackr/settings',
            '@subtrackr/auth_token',
            '@subtrackr/preferred_currency',
          ],
          installGlobalHandler: true,
        });

        if (previousCrash && !cancelled) {
          setPendingCrash(previousCrash);
          setShowRecoveryModal(true);
        }
      } finally {
        if (!cancelled) setI18nReady(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRecover = async () => {
    if (pendingCrash) {
      const success = await crashReporter.attemptDataRecovery(pendingCrash.id);
      await crashReporter.markNotified(pendingCrash.id);
      setShowRecoveryModal(false);
      setPendingCrash(null);
      if (!success) {
        Alert.alert(
          'Recovery Incomplete',
          'Some data could not be restored. The app will continue with a fresh state.'
        );
      }
    }
  };

  const handleDismissRecovery = async () => {
    if (pendingCrash) {
      await crashReporter.markNotified(pendingCrash.id);
    }
    setShowRecoveryModal(false);
    setPendingCrash(null);
  };

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
        <CrashRecoveryModal
          visible={showRecoveryModal}
          crash={pendingCrash}
          onRecover={handleRecover}
          onDismiss={handleDismissRecovery}
        />
      </View>
    </GestureHandlerRootView>
  );
}
