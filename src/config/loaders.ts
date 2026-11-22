import type { Env } from './env';

/**
 * Feature-scoped views over the validated environment. Each loader exposes only
 * the keys one feature needs, so callers stop importing the whole `Env`.
 */
export type ConfigSource = Pick<Env, 'EXPO_PUBLIC_API_URL' | 'SUBTRACKR_API_KEY'> &
  Pick<
    Env,
    | 'WALLET_CONNECT_PROJECT_ID'
    | 'STELLAR_NETWORK'
    | 'USE_SANDBOX_CONTRACTS'
    | 'ENABLE_DEBUG_LOGS'
    | 'APP_ENV'
  >;

export interface ApiConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface WalletConfig {
  walletConnectProjectId: string;
  network: Env['STELLAR_NETWORK'];
  sandboxContracts: boolean;
}

export interface DiagnosticsConfig {
  appEnv: Env['APP_ENV'];
  debugLogs: boolean;
}

export const loadApiConfig = (env: ConfigSource): ApiConfig => ({
  baseUrl: env.EXPO_PUBLIC_API_URL.replace(/\/+$/, ''),
  apiKey: env.SUBTRACKR_API_KEY,
});

export const loadWalletConfig = (env: ConfigSource): WalletConfig => ({
  walletConnectProjectId: env.WALLET_CONNECT_PROJECT_ID,
  network: env.STELLAR_NETWORK,
  sandboxContracts: env.USE_SANDBOX_CONTRACTS,
});

export const loadDiagnosticsConfig = (env: ConfigSource): DiagnosticsConfig => ({
  appEnv: env.APP_ENV,
  debugLogs: env.ENABLE_DEBUG_LOGS,
});
