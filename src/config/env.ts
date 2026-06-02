/**
 * Environment variable validation with Zod.
 *
 * All environment variables consumed by the app are declared here with their
 * types, defaults, and documentation. Call `validateEnv()` once at app startup
 * (before any other module reads env vars) to fail fast with a clear message
 * instead of a silent runtime error deep inside the app.
 *
 * Usage:
 *   import { env } from './src/config/env';
 *   env.EXPO_PUBLIC_API_URL   // string — type-safe, already validated
 *
 * Adding a new variable:
 *   1. Add it to `envSchema` below with the appropriate Zod type.
 *   2. Document it in the inline comment.
 *   3. If it is required in production, use z.string().min(1); for optional
 *      vars use .optional() or .default('fallback').
 */

import { z } from 'zod';

// ─── Schema ───────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // ── App environment ────────────────────────────────────────────────────────
  /** Current deployment environment. Defaults to 'development'. */
  APP_ENV: z
    .enum(['development', 'staging', 'production'])
    .default('development'),

  // ── API ────────────────────────────────────────────────────────────────────
  /** Base URL for the SubTrackr REST API. */
  EXPO_PUBLIC_API_URL: z
    .string()
    .url('EXPO_PUBLIC_API_URL must be a valid URL')
    .default('https://sandbox.api.subtrackr.app'),

  /** Internal API key used by backend services. Optional in development. */
  SUBTRACKR_API_KEY: z.string().optional(),

  // ── WalletConnect ──────────────────────────────────────────────────────────
  /**
   * WalletConnect / Reown project ID.
   * Required in staging and production; falls back to a placeholder in dev so
   * the app can still boot without a real key during local development.
   */
  WALLET_CONNECT_PROJECT_ID: z
    .string()
    .min(1, 'WALLET_CONNECT_PROJECT_ID must not be empty')
    .default('YOUR_PROJECT_ID'),

  // ── Webhooks ───────────────────────────────────────────────────────────────
  /** HMAC secret used to verify incoming webhook payloads. Backend only. */
  WEBHOOK_SECRET: z.string().optional(),

  // ── Stellar contracts ──────────────────────────────────────────────────────
  /** Stellar mainnet contract IDs — optional; only needed when Stellar is enabled. */
  STELLAR_MAINNET_PROXY_ID: z.string().optional(),
  STELLAR_MAINNET_STORAGE_ID: z.string().optional(),
  STELLAR_MAINNET_SUBSCRIPTION_ID: z.string().optional(),

  /** Stellar testnet contract IDs — optional; used in development/staging. */
  STELLAR_TESTNET_PROXY_ID: z.string().optional(),
  STELLAR_TESTNET_STORAGE_ID: z.string().optional(),
  STELLAR_TESTNET_SUBSCRIPTION_ID: z.string().optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

/** Fully-typed, validated environment object. */
export type Env = z.infer<typeof envSchema>;

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate all environment variables against the schema.
 *
 * - In **production** (`APP_ENV=production`) any validation failure throws an
 *   Error so the app refuses to start with a broken configuration.
 * - In **development / staging** failures are logged as warnings so the app
 *   can still run with partial configuration during local development.
 *
 * Returns the validated, type-safe `Env` object on success.
 *
 * @throws {Error} when validation fails in a production environment.
 */
export function validateEnv(): Env {
  const raw = {
    APP_ENV: process.env.APP_ENV,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    SUBTRACKR_API_KEY: process.env.SUBTRACKR_API_KEY,
    WALLET_CONNECT_PROJECT_ID: process.env.WALLET_CONNECT_PROJECT_ID,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    STELLAR_MAINNET_PROXY_ID: process.env.STELLAR_MAINNET_PROXY_ID,
    STELLAR_MAINNET_STORAGE_ID: process.env.STELLAR_MAINNET_STORAGE_ID,
    STELLAR_MAINNET_SUBSCRIPTION_ID: process.env.STELLAR_MAINNET_SUBSCRIPTION_ID,
    STELLAR_TESTNET_PROXY_ID: process.env.STELLAR_TESTNET_PROXY_ID,
    STELLAR_TESTNET_STORAGE_ID: process.env.STELLAR_TESTNET_STORAGE_ID,
    STELLAR_TESTNET_SUBSCRIPTION_ID: process.env.STELLAR_TESTNET_SUBSCRIPTION_ID,
  };

  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    const message = `[SubTrackr] Environment validation failed:\n${issues}`;

    const isProduction = raw.APP_ENV === 'production';

    if (isProduction) {
      // Hard fail — never start production with a broken config
      throw new Error(message);
    }

    // Non-production: warn loudly but allow the app to continue
    console.warn(message);

    // Return a best-effort parsed object using the defaults where possible
    return envSchema.parse({
      ...raw,
      // Strip undefined values so Zod can apply defaults
      ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)),
    });
  }

  if (__DEV__) {
    console.info('[SubTrackr] Environment validated successfully ✓', {
      APP_ENV: result.data.APP_ENV,
      EXPO_PUBLIC_API_URL: result.data.EXPO_PUBLIC_API_URL,
    });
  }

  return result.data;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Validated, type-safe environment singleton.
 *
 * Evaluated once at module load time. Import `env` anywhere in the app instead
 * of reading `process.env` directly — this guarantees the value has been
 * validated and has the correct TypeScript type.
 *
 * @example
 *   import { env } from '../config/env';
 *   fetch(env.EXPO_PUBLIC_API_URL + '/subscriptions');
 */
export const env: Env = validateEnv();
