import {
  ConfigService,
  backendEnvironmentProfiles,
  configService,
  resolveBackendEnvironment,
} from '../configService';

describe('ConfigService', () => {
  it('loads default environment configuration from the singleton', () => {
    const config = configService.getConfig();

    expect(config).toBeDefined();
    expect(config.env).toBeDefined();
    expect(config.port).toBeGreaterThan(0);
  });

  it('resolves APP_ENV before NODE_ENV', () => {
    expect(resolveBackendEnvironment({ APP_ENV: 'staging', NODE_ENV: 'production' })).toBe(
      'staging'
    );
  });

  it('loads environment-specific defaults', () => {
    const service = ConfigService.fromEnv({}, 'test');
    const config = service.getConfig();

    expect(config.env).toBe('test');
    expect(config.databaseUrl).toContain('subtrackr_test');
    expect(config.secretsProvider).toBe('local');
  });

  it('applies process overrides on top of an environment profile', () => {
    const service = ConfigService.fromEnv(
      {
        PORT: '4100',
        DATABASE_URL: 'postgresql://db.internal:5432/custom',
        REDIS_URL: 'redis://redis.internal:6379',
        JWT_SECRET: 'custom-secret-value',
        AWS_SECRET_ID: 'subtrackr/staging',
      },
      'staging'
    );

    expect(service.getConfig()).toMatchObject({
      env: 'staging',
      port: 4100,
      databaseUrl: 'postgresql://db.internal:5432/custom',
      secretManagerSecretId: 'subtrackr/staging',
    });
  });

  it('rejects production config without managed secrets', () => {
    expect(() =>
      ConfigService.fromEnv(
        {
          DATABASE_URL: 'postgresql://prod.internal:5432/subtrackr',
          REDIS_URL: 'redis://prod.internal:6379',
          JWT_SECRET: 'production-secret-value',
        },
        'production'
      )
    ).toThrow('AWS_SECRET_ID must be set');
  });

  it('rejects production config with localhost infrastructure', () => {
    expect(() =>
      ConfigService.fromEnv(
        {
          DATABASE_URL: 'postgresql://localhost:5432/subtrackr',
          REDIS_URL: 'redis://localhost:6379',
          JWT_SECRET: 'production-secret-value',
          AWS_SECRET_ID: 'subtrackr/prod',
        },
        'production'
      )
    ).toThrow('Production DATABASE_URL cannot point at localhost');
  });

  it('fetches and caches aws-backed secrets when enabled', async () => {
    const service = ConfigService.fromEnv(
      {
        DATABASE_URL: 'postgresql://prod.internal:5432/subtrackr',
        REDIS_URL: 'redis://prod.internal:6379',
        JWT_SECRET: 'production-secret-value',
        AWS_SECRET_ID: 'subtrackr/prod',
      },
      'production'
    );

    await expect(service.fetchSecretFromAws('jwt')).resolves.toBe('aws-secret-value-for-jwt');
    await expect(service.fetchSecretFromAws('jwt')).resolves.toBe('aws-secret-value-for-jwt');
  });

  it('does not fetch aws secrets for local profiles', async () => {
    const service = ConfigService.fromEnv({}, 'development');

    await expect(service.fetchSecretFromAws('jwt')).resolves.toBeNull();
  });

  it('compares configurations accurately', () => {
    const service = ConfigService.fromEnv({}, 'development');
    const configA = { port: 3000, env: 'development' as const };
    const configB = { port: 8080, env: 'development' as const };
    const diffs = service.compareConfigs(configA, configB);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe('port');
  });

  it('detects config drift', () => {
    const service = ConfigService.fromEnv({}, 'development');
    const expected = {
      ...backendEnvironmentProfiles.production,
      secretManagerSecretId: 'subtrackr/prod',
    };
    const drift = service.detectDrift(expected);

    expect(drift.length).toBeGreaterThan(0);
  });

  it('refreshes configuration and clears secret profile state', () => {
    const service = ConfigService.fromEnv({}, 'development');
    const refreshed = service.refreshConfig('test');

    expect(refreshed.env).toBe('test');
  });
});
