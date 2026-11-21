import {
  ConfigSource,
  loadApiConfig,
  loadDiagnosticsConfig,
  loadWalletConfig,
} from '../loaders';

const source: ConfigSource = {
  APP_ENV: 'staging',
  EXPO_PUBLIC_API_URL: 'https://staging.api.subtrackr.app///',
  SUBTRACKR_API_KEY: 'key',
  WALLET_CONNECT_PROJECT_ID: 'pid',
  STELLAR_NETWORK: 'testnet',
  USE_SANDBOX_CONTRACTS: true,
  ENABLE_DEBUG_LOGS: false,
};

describe('feature-scoped config loaders', () => {
  it('trims trailing slashes from the API base URL', () => {
    expect(loadApiConfig(source)).toEqual({
      baseUrl: 'https://staging.api.subtrackr.app',
      apiKey: 'key',
    });
  });

  it('exposes only wallet keys', () => {
    expect(loadWalletConfig(source)).toEqual({
      walletConnectProjectId: 'pid',
      network: 'testnet',
      sandboxContracts: true,
    });
  });

  it('exposes only diagnostics keys', () => {
    expect(loadDiagnosticsConfig(source)).toEqual({ appEnv: 'staging', debugLogs: false });
  });
});
