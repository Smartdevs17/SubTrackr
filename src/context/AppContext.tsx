/**
 * Global App Context Provider
 *
 * Provides a unified context for cross-cutting app concerns:
 * - App initialization state
 * - Global error boundary
 * - Feature flags access
 * - Theme preferences
 */

import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useWalletStore } from '../store/walletStore';
import { useNetworkStore } from '../store/networkStore';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppState {
  isInitialized: boolean;
  isOnline: boolean;
  version: string;
}

interface AppContextValue {
  // App state
  state: AppState;

  // Settings
  preferredCurrency: string;
  setPreferredCurrency: (currency: string) => void;

  // Wallet
  isConnected: boolean;
  walletAddress: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;

  // Network
  currentNetwork: string;
  setNetwork: (network: string) => void;

  // Error handling
  globalError: Error | null;
  setGlobalError: (error: Error | null) => void;
  clearGlobalError: () => void;
}

// ── Context Creation ──────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

// ── Provider Component ────────────────────────────────────────────────────────

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [globalError, setGlobalError] = useState<Error | null>(null);

  // Settings store
  const preferredCurrency = useSettingsStore((s) => s.preferredCurrency);
  const setPreferredCurrency = useSettingsStore((s) => s.setPreferredCurrency);

  // Wallet store
  const isConnected = useWalletStore((s) => s.isConnected);
  const walletAddress = useWalletStore((s) => s.walletAddress);
  const connectWallet = useWalletStore((s) => s.connect);
  const disconnectWallet = useWalletStore((s) => s.disconnect);

  // Network store
  const currentNetwork = useNetworkStore((s) => s.currentNetwork);
  const setNetwork = useNetworkStore((s) => s.setNetwork);

  // Monitor connectivity
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    setIsOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Mark as initialized after first render
  useEffect(() => {
    setIsInitialized(true);
  }, []);

  const clearGlobalError = useCallback(() => setGlobalError(null), []);

  const value: AppContextValue = useMemo(
    () => ({
      state: {
        isInitialized,
        isOnline,
        version: '1.0.0',
      },
      preferredCurrency,
      setPreferredCurrency,
      isConnected,
      walletAddress,
      connectWallet,
      disconnectWallet,
      currentNetwork,
      setNetwork,
      globalError,
      setGlobalError,
      clearGlobalError,
    }),
    [
      isInitialized,
      isOnline,
      preferredCurrency,
      setPreferredCurrency,
      isConnected,
      walletAddress,
      connectWallet,
      disconnectWallet,
      currentNetwork,
      setNetwork,
      globalError,
      setGlobalError,
      clearGlobalError,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ── Custom Hooks ──────────────────────────────────────────────────────────────

/**
 * Hook to access the global app context.
 */
export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

/**
 * Hook to access only app initialization state.
 */
export function useAppInitialization() {
  const isInitialized = useAppContext().state.isInitialized;
  const isOnline = useAppContext().state.isOnline;
  return useMemo(() => ({ isInitialized, isOnline }), [isInitialized, isOnline]);
}

/**
 * Hook to access wallet connection state.
 */
export function useWalletConnection() {
  const isConnected = useAppContext().isConnected;
  const walletAddress = useAppContext().walletAddress;
  const connectWallet = useAppContext().connectWallet;
  const disconnectWallet = useAppContext().disconnectWallet;
  return useMemo(
    () => ({ isConnected, walletAddress, connectWallet, disconnectWallet }),
    [isConnected, walletAddress, connectWallet, disconnectWallet]
  );
}
