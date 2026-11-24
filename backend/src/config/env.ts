/**
 * backend/src/config/env.ts
 *
 * Issue #2211 — Refactored environment configuration schema with Zod validation.
 *
 * This module provides the canonical, type-safe environment configuration for
 * the backend. It is the backend counterpart of `src/config/env.ts` on the
 * frontend.
 *
 * Key features:
 *   - Full Zod schema for every variable the backend reads from `process.env`.
 *   - Per-environment profiles with sensible defaults so local development
 *     works out of the box without a full `.env` file.
 *   - Production guard: refuses to start when secrets hold placeholder values.
 *   - `validateBackendEnv()` mirrors `validateEnv()` from the frontend: in
 *     production it throws, in lower environments it warns and falls back to
 *     the profile defaults.
 *   - Re-exports the singleton `backendEnv` for use throughout the codebase.
 *
 * Usage:
 *   import { backendEnv } from '../config/env';
 *   console.log(backendEnv.DATABASE_URL);
 */

import { z } from 'zod';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BackendAppEnvironment = 'development' | 'staging' | 'production' | 'test';
export type EnvSource = Record<string, string | undefined>;
export type SecretsProvider = 'local' | 'aws';

// ─── Per-environment defaults ─────────────────────────────────────────────────

export interface BackendEnvironmentProfile {
  APP_ENV: BackendAppEnvironment;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  AWS_REGION: string;
  SECRETS_PROVIDER: SecretsProvider;
  REQUIRE_MANAGED_SECRETS: boolean;
}

export const backendEnvironmentProfiles: Record<BackendAppEnvironment, BackendEnvironmentProfile> =
  {
    development: {
      APP_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: 'postgresql://localhost:5432/subtrackr',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'dev-jwt-secret-key-change-in-prod',
      AWS_REGION: 'us-east-1',
      SECRETS_PROVIDER: 'local',
      REQUIRE_MANAGED_SECRETS: false,
    },
    test: {
      APP_ENV: 'test',
      PORT: 3001,
      DATABASE_URL: 'postgresql://localhost:5432/subtrackr_test',
      REDIS_URL: 'redis://localhost:6379/1',
      JWT_SECRET: 'test-jwt-secret-key',
      AWS_REGION: 'us-east-1',
      SECRETS_PROVIDER: 'local',
      REQUIRE_MANAGED_SECRETS: false,
    },
    staging: {
      APP_ENV: 'staging',
      PORT: 3000,
      DATABASE_URL: 'postgresql://staging-db.subtrackr.internal:5432/subtrackr',
      REDIS_URL: 'redis://staging-redis.subtrackr.internal:6379',
      JWT_SECRET: 'staging-jwt-secret-key',
      AWS_REGION: 'us-east-1',
      SECRETS_PROVIDER: 'aws',
      REQUIRE_MANAGED_SECRETS: true,
    },
    production: {
      APP_ENV: 'production',
      PORT: 8080,
      DATABASE_URL: 'postgresql://prod-db.subtrackr.internal:5432/subtrackr',
      REDIS_URL: 'redis://prod-redis.subtrackr.internal:6379',
      JWT_SECRET: 'production-jwt-secret-required',
      AWS_REGION: 'us-east-1',
      SECRETS_PROVIDER: 'aws',
      REQUIRE_MANAGED_SECRETS: true,
    },
  };

// ─── Zod schema ───────────────────────────────────────────────────────────────

const optionalSecret = z.string().trim().min(1).optional();

export const backendEnvSchema = z
  .object({
    APP_ENV: z
      .enum(['development', 'staging', 'production', 'test'])
      .default('development'),
    PORT: z.number().int().positive().default(3000),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL must not be empty')
      .refine((v) => v.startsWith('postgres'), {
        message: 'DATABASE_URL must be a PostgreSQL connection string',
      }),
    REDIS_URL: z
      .string()
      .min(1, 'REDIS_URL must not be empty')
      .refine((v) => v.startsWith('redis'), {
        message: 'REDIS_URL must be a Redis connection string',
      }),
    JWT_SECRET: z
      .string()
      .min(12, 'JWT_SECRET must be at least 12 characters'),
    AWS_REGION: z.string().min(1).default('us-east-1'),
    AWS_SECRET_ID: optionalSecret,
    SECRETS_PROVIDER: z.enum(['local', 'aws']).default('local'),
    REQUIRE_MANAGED_SECRETS: z.boolean().default(false),
    // Shopify (optional — only required when SHOPIFY_SHOP_DOMAIN is set)
    SHOPIFY_SHOP_DOMAIN: optionalSecret,
    SHOPIFY_ADMIN_ACCESS_TOKEN: optionalSecret,
    SHOPIFY_WEBHOOK_SECRET: optionalSecret,
    // Stripe
    STRIPE_SECRET_KEY: optionalSecret,
    STRIPE_WEBHOOK_SECRET: optionalSecret,
    // Circle
    CIRCLE_API_KEY: optionalSecret,
    // Stellar / Soroban
    STELLAR_NETWORK: z.enum(['mainnet', 'testnet']).optional(),
    STELLAR_RPC_URL: optionalSecret,
    SOROBAN_CONTRACT_ID: optionalSecret,
    // Observability
    SENTRY_DSN: optionalSecret,
    LOG_LEVEL: z
      .enum(['debug', 'info', 'warn', 'error', 'silent'])
      .default('info'),
    // Feature flags
    ENABLE_FRAUD_DETECTION: z.boolean().default(true),
    ENABLE_SLA_MONITORING: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.APP_ENV !== 'production') return;

    // Reject placeholder secrets in production.
    const placeholderPattern =
      /^(dev-|test-|staging-|production-jwt-secret-required|change-in-prod)/i;

    if (placeholderPattern.test(value.JWT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be set to a strong secret in production',
      });
    }

    if (
      value.DATABASE_URL.includes('localhost') ||
      value.DATABASE_URL.includes('127.0.0.1')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'Production must not use a localhost database',
      });
    }

    if (value.SECRETS_PROVIDER !== 'aws') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SECRETS_PROVIDER'],
        message: 'Production must use AWS Secrets Manager (SECRETS_PROVIDER=aws)',
      });
    }

    if (value.SHOPIFY_SHOP_DOMAIN && !value.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SHOPIFY_ADMIN_ACCESS_TOKEN'],
        message:
          'SHOPIFY_ADMIN_ACCESS_TOKEN is required when SHOPIFY_SHOP_DOMAIN is set',
      });
    }
  });

export type BackendEnv = z.infer<typeof backendEnvSchema>;

// ─── Resolution helpers ───────────────────────────────────────────────────────

export function resolveBackendAppEnvironment(
  source: EnvSource = process.env
): BackendAppEnvironment {
  const explicit = source.APP_ENV ?? source.NODE_ENV;
  if (isBackendAppEnvironment(explicit)) return explicit;
  return 'development';
}

export function getBackendEnvironmentProfile(
  env: BackendAppEnvironment
): BackendEnvironmentProfile {
  return { ...backendEnvironmentProfiles[env] };
}

/** Build the raw merged config object (profile defaults + env overrides). */
export function buildBackendRawEnv(
  source: EnvSource,
  APP_ENV: BackendAppEnvironment
): Record<string, unknown> {
  const profile = backendEnvironmentProfiles[APP_ENV];

  return stripUndefined({
    ...profile,
    APP_ENV,
    PORT: parsePort(source.PORT, profile.PORT),
    DATABASE_URL: source.DATABASE_URL ?? profile.DATABASE_URL,
    REDIS_URL: source.REDIS_URL ?? profile.REDIS_URL,
    JWT_SECRET: source.JWT_SECRET ?? profile.JWT_SECRET,
    AWS_REGION: source.AWS_REGION ?? profile.AWS_REGION,
    AWS_SECRET_ID: source.AWS_SECRET_ID,
    SECRETS_PROVIDER:
      (source.SECRETS_PROVIDER as SecretsProvider | undefined) ?? profile.SECRETS_PROVIDER,
    REQUIRE_MANAGED_SECRETS: parseBoolean(
      source.REQUIRE_MANAGED_SECRETS,
      profile.REQUIRE_MANAGED_SECRETS
    ),
    SHOPIFY_SHOP_DOMAIN: source.SHOPIFY_SHOP_DOMAIN,
    SHOPIFY_ADMIN_ACCESS_TOKEN: source.SHOPIFY_ADMIN_ACCESS_TOKEN,
    SHOPIFY_WEBHOOK_SECRET: source.SHOPIFY_WEBHOOK_SECRET,
    STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET,
    CIRCLE_API_KEY: source.CIRCLE_API_KEY,
    STELLAR_NETWORK: source.STELLAR_NETWORK as 'mainnet' | 'testnet' | undefined,
    STELLAR_RPC_URL: source.STELLAR_RPC_URL,
    SOROBAN_CONTRACT_ID: source.SOROBAN_CONTRACT_ID,
    SENTRY_DSN: source.SENTRY_DSN,
    LOG_LEVEL: source.LOG_LEVEL,
    ENABLE_FRAUD_DETECTION: parseBoolean(source.ENABLE_FRAUD_DETECTION, true),
    ENABLE_SLA_MONITORING: parseBoolean(source.ENABLE_SLA_MONITORING, true),
  });
}

/** Load and parse the config without any error handling — throws on invalid input. */
export function loadBackendEnvConfig(
  source: EnvSource = process.env,
  overrideEnv?: BackendAppEnvironment
): BackendEnv {
  const APP_ENV = overrideEnv ?? resolveBackendAppEnvironment(source);
  return backendEnvSchema.parse(buildBackendRawEnv(source, APP_ENV));
}

/**
 * Validate backend environment variables once at startup.
 *
 * Production throws on validation failure (hard startup guard).
 * Non-production logs a warning and falls back to profile defaults.
 */
export function validateBackendEnv(
  source: EnvSource = process.env,
  overrideEnv?: BackendAppEnvironment
): BackendEnv {
  const APP_ENV = overrideEnv ?? resolveBackendAppEnvironment(source);
  const result = backendEnvSchema.safeParse(buildBackendRawEnv(source, APP_ENV));

  if (!result.success) {
    const message = formatBackendEnvIssues(result.error.issues);

    if (APP_ENV === 'production') {
      throw new Error(message);
    }

    // eslint-disable-next-line no-console
    console.warn(message);
    return loadBackendEnvConfig({}, APP_ENV);
  }

  if (APP_ENV !== 'production' && APP_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.info('[SubTrackr Backend] Environment validated', {
      APP_ENV: result.data.APP_ENV,
      PORT: result.data.PORT,
      SECRETS_PROVIDER: result.data.SECRETS_PROVIDER,
    });
  }

  return result.data;
}

/**
 * Pre-validated singleton for use throughout the backend. Throws at module
 * load time in production when the config is invalid.
 */
export const backendEnv: BackendEnv = validateBackendEnv();

// ─── Private helpers ──────────────────────────────────────────────────────────

function isBackendAppEnvironment(value: unknown): value is BackendAppEnvironment {
  return (
    value === 'development' ||
    value === 'staging' ||
    value === 'production' ||
    value === 'test'
  );
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (/^(1|true|yes)$/i.test(value)) return true;
  if (/^(0|false|no)$/i.test(value)) return false;
  return fallback;
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined)
  ) as T;
}

function formatBackendEnvIssues(issues: z.ZodIssue[]): string {
  return [
    '[SubTrackr Backend] Environment validation failed:',
    ...issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`),
  ].join('\n');
}
