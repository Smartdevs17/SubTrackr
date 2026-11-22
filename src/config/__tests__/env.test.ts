import {
  getEnvironmentProfile,
  loadEnvironmentConfig,
  resolveAppEnvironment,
  validateEnv,
} from '../env';

describe('app environment config', () => {
  const originalWarn = console.warn;

  afterEach(() => {
    console.warn = originalWarn;
  });

  it('resolves APP_ENV before NODE_ENV', () => {
    expect(resolveAppEnvironment({ APP_ENV: 'staging', NODE_ENV: 'production' })).toBe('staging');
  });

  it('falls back to development for unknown environments', () => {
    expect(resolveAppEnvironment({ APP_ENV: 'preview' })).toBe('development');
  });

  it('loads the selected environment profile defaults', () => {
    const config = loadEnvironmentConfig({}, 'staging');

    expect(config.APP_ENV).toBe('staging');
    expect(config.EXPO_PUBLIC_API_URL).toBe('https://staging.api.subtrackr.app');
    expect(config.STELLAR_NETWORK).toBe('testnet');
    expect(config.USE_SANDBOX_CONTRACTS).toBe(true);
  });

  it('allows valid production overrides', () => {
    const config = validateEnv(
      {
        EXPO_PUBLIC_API_URL: 'https://api.subtrackr.example',
        WALLET_CONNECT_PROJECT_ID: 'wc_live_123',
      },
      'production'
    );

    expect(config.APP_ENV).toBe('production');
    expect(config.STELLAR_NETWORK).toBe('mainnet');
    expect(config.USE_SANDBOX_CONTRACTS).toBe(false);
  });

  it('rejects production placeholder wallet configuration', () => {
    expect(() => validateEnv({}, 'production')).toThrow(
      'WALLET_CONNECT_PROJECT_ID must be set to a real production project ID'
    );
  });

  it('rejects sandbox endpoints in production', () => {
    expect(() =>
      validateEnv(
        {
          EXPO_PUBLIC_API_URL: 'https://sandbox.api.subtrackr.app',
          WALLET_CONNECT_PROJECT_ID: 'wc_live_123',
        },
        'production'
      )
    ).toThrow('Production cannot use sandbox');
  });

  it('warns and returns profile defaults for invalid non-production values', () => {
    console.warn = jest.fn();

    const config = validateEnv({ EXPO_PUBLIC_API_URL: 'not-a-url' }, 'development');

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('EXPO_PUBLIC_API_URL must be a valid URL')
    );
    expect(config.EXPO_PUBLIC_API_URL).toBe(
      getEnvironmentProfile('development').EXPO_PUBLIC_API_URL
    );
  });
});
