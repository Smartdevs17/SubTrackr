/**
 * backend/src/config/__tests__/env.test.ts
 *
 * Tests for the backend environment configuration schema (issue #2211).
 */

import {
  resolveBackendAppEnvironment,
  getBackendEnvironmentProfile,
  loadBackendEnvConfig,
  validateBackendEnv,
  buildBackendRawEnv,
  type BackendAppEnvironment,
} from '../env';

const originalWarn = console.warn;
const originalInfo = console.info;

afterEach(() => {
  console.warn = originalWarn;
  console.info = originalInfo;
});

// ─── resolveBackendAppEnvironment ─────────────────────────────────────────────

describe('resolveBackendAppEnvironment', () => {
  it('uses APP_ENV when set', () => {
    expect(resolveBackendAppEnvironment({ APP_ENV: 'staging' })).toBe('staging');
  });

  it('falls back to NODE_ENV when APP_ENV is absent', () => {
    expect(resolveBackendAppEnvironment({ NODE_ENV: 'test' })).toBe('test');
  });

  it('defaults to development for unknown values', () => {
    expect(resolveBackendAppEnvironment({ APP_ENV: 'preview' })).toBe('development');
    expect(resolveBackendAppEnvironment({})).toBe('development');
  });

  it('APP_ENV takes priority over NODE_ENV', () => {
    expect(
      resolveBackendAppEnvironment({ APP_ENV: 'staging', NODE_ENV: 'production' })
    ).toBe('staging');
  });
});

// ─── getBackendEnvironmentProfile ─────────────────────────────────────────────

describe('getBackendEnvironmentProfile', () => {
  const envs: BackendAppEnvironment[] = ['development', 'test', 'staging', 'production'];

  it.each(envs)('returns a profile for %s', (env) => {
    const profile = getBackendEnvironmentProfile(env);
    expect(profile.APP_ENV).toBe(env);
    expect(typeof profile.PORT).toBe('number');
    expect(profile.DATABASE_URL).toBeTruthy();
  });

  it('returns a copy — mutations do not affect the original', () => {
    const profile = getBackendEnvironmentProfile('development');
    profile.PORT = 9999;
    expect(getBackendEnvironmentProfile('development').PORT).not.toBe(9999);
  });
});

// ─── loadBackendEnvConfig ─────────────────────────────────────────────────────

describe('loadBackendEnvConfig', () => {
  it('loads development defaults when no env vars are set', () => {
    const config = loadBackendEnvConfig({}, 'development');
    expect(config.APP_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL).toContain('localhost');
    expect(config.SECRETS_PROVIDER).toBe('local');
    expect(config.REQUIRE_MANAGED_SECRETS).toBe(false);
    expect(config.ENABLE_FRAUD_DETECTION).toBe(true);
    expect(config.ENABLE_SLA_MONITORING).toBe(true);
  });

  it('loads test defaults', () => {
    const config = loadBackendEnvConfig({}, 'test');
    expect(config.APP_ENV).toBe('test');
    expect(config.PORT).toBe(3001);
    expect(config.DATABASE_URL).toContain('subtrackr_test');
    expect(config.REDIS_URL).toContain('/1');
  });

  it('loads staging defaults', () => {
    const config = loadBackendEnvConfig({}, 'staging');
    expect(config.APP_ENV).toBe('staging');
    expect(config.SECRETS_PROVIDER).toBe('aws');
    expect(config.REQUIRE_MANAGED_SECRETS).toBe(true);
  });

  it('allows env vars to override profile defaults', () => {
    const config = loadBackendEnvConfig(
      {
        DATABASE_URL: 'postgresql://custom-host:5432/mydb',
        REDIS_URL: 'redis://custom-redis:6379',
        PORT: '4000',
        JWT_SECRET: 'custom-secret-at-least-12chars',
      },
      'development'
    );
    expect(config.DATABASE_URL).toBe('postgresql://custom-host:5432/mydb');
    expect(config.REDIS_URL).toBe('redis://custom-redis:6379');
    expect(config.PORT).toBe(4000);
    expect(config.JWT_SECRET).toBe('custom-secret-at-least-12chars');
  });

  it('parses boolean feature flags from string env vars', () => {
    const config = loadBackendEnvConfig(
      { ENABLE_FRAUD_DETECTION: 'false', ENABLE_SLA_MONITORING: '0' },
      'development'
    );
    expect(config.ENABLE_FRAUD_DETECTION).toBe(false);
    expect(config.ENABLE_SLA_MONITORING).toBe(false);
  });

  it('includes optional Shopify fields when set', () => {
    const config = loadBackendEnvConfig(
      {
        SHOPIFY_SHOP_DOMAIN: 'my-shop.myshopify.com',
        SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_abc123',
      },
      'development'
    );
    expect(config.SHOPIFY_SHOP_DOMAIN).toBe('my-shop.myshopify.com');
    expect(config.SHOPIFY_ADMIN_ACCESS_TOKEN).toBe('shpat_abc123');
  });

  it('throws for invalid DATABASE_URL', () => {
    expect(() =>
      loadBackendEnvConfig(
        { DATABASE_URL: 'mysql://localhost/db' },
        'development'
      )
    ).toThrow('DATABASE_URL must be a PostgreSQL connection string');
  });

  it('throws for invalid REDIS_URL', () => {
    expect(() =>
      loadBackendEnvConfig(
        { REDIS_URL: 'amqp://localhost' },
        'development'
      )
    ).toThrow('REDIS_URL must be a Redis connection string');
  });

  it('throws for JWT_SECRET shorter than 12 characters', () => {
    expect(() =>
      loadBackendEnvConfig({ JWT_SECRET: 'tooshort' }, 'development')
    ).toThrow('JWT_SECRET');
  });
});

// ─── validateBackendEnv ───────────────────────────────────────────────────────

describe('validateBackendEnv', () => {
  it('returns valid config for a development environment without warnings', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = validateBackendEnv({}, 'development');
    expect(config.APP_ENV).toBe('development');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('warns and falls back to defaults in non-production when env is invalid', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = validateBackendEnv({ JWT_SECRET: 'x' }, 'development');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Environment validation failed')
    );
    // Falls back to development profile
    expect(config.APP_ENV).toBe('development');
    warnSpy.mockRestore();
  });

  it('throws in production with placeholder JWT_SECRET', () => {
    expect(() =>
      validateBackendEnv(
        {
          DATABASE_URL: 'postgresql://prod-db.example.com:5432/subtrackr',
          REDIS_URL: 'redis://prod-redis.example.com:6379',
          JWT_SECRET: 'production-jwt-secret-required',
          SECRETS_PROVIDER: 'aws',
        },
        'production'
      )
    ).toThrow('JWT_SECRET');
  });

  it('throws in production when DATABASE_URL targets localhost', () => {
    expect(() =>
      validateBackendEnv(
        {
          DATABASE_URL: 'postgresql://localhost:5432/subtrackr',
          REDIS_URL: 'redis://prod-redis.example.com:6379',
          JWT_SECRET: 'a-strong-production-secret-key!',
          SECRETS_PROVIDER: 'aws',
        },
        'production'
      )
    ).toThrow('localhost');
  });

  it('throws in production when SECRETS_PROVIDER is not aws', () => {
    expect(() =>
      validateBackendEnv(
        {
          DATABASE_URL: 'postgresql://prod-db.example.com:5432/subtrackr',
          REDIS_URL: 'redis://prod-redis.example.com:6379',
          JWT_SECRET: 'a-strong-production-secret-key!',
          SECRETS_PROVIDER: 'local',
        },
        'production'
      )
    ).toThrow('aws');
  });

  it('throws in production when SHOPIFY_SHOP_DOMAIN is set without token', () => {
    expect(() =>
      validateBackendEnv(
        {
          DATABASE_URL: 'postgresql://prod-db.example.com:5432/subtrackr',
          REDIS_URL: 'redis://prod-redis.example.com:6379',
          JWT_SECRET: 'a-strong-production-secret-key!',
          SECRETS_PROVIDER: 'aws',
          SHOPIFY_SHOP_DOMAIN: 'my-shop.myshopify.com',
          // SHOPIFY_ADMIN_ACCESS_TOKEN deliberately omitted
        },
        'production'
      )
    ).toThrow('SHOPIFY_ADMIN_ACCESS_TOKEN');
  });

  it('succeeds in production with all required fields valid', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const config = validateBackendEnv(
      {
        DATABASE_URL: 'postgresql://prod-db.example.com:5432/subtrackr',
        REDIS_URL: 'redis://prod-redis.example.com:6379',
        JWT_SECRET: 'a-strong-production-secret-key!',
        SECRETS_PROVIDER: 'aws',
      },
      'production'
    );
    expect(config.APP_ENV).toBe('production');
    expect(config.SECRETS_PROVIDER).toBe('aws');
    infoSpy.mockRestore();
  });
});

// ─── buildBackendRawEnv ───────────────────────────────────────────────────────

describe('buildBackendRawEnv', () => {
  it('merges profile defaults with source overrides', () => {
    const raw = buildBackendRawEnv(
      { DATABASE_URL: 'postgresql://custom:5432/db' },
      'development'
    );
    expect(raw.DATABASE_URL).toBe('postgresql://custom:5432/db');
    expect(raw.PORT).toBe(3000); // profile default
  });

  it('strips undefined values', () => {
    const raw = buildBackendRawEnv({}, 'development');
    expect(Object.values(raw).some((v) => v === undefined)).toBe(false);
  });
});
