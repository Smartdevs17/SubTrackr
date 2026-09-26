import { z } from 'zod';

export type AppEnvironment = 'development' | 'staging' | 'production' | 'test';
export type EnvSource = Record<string, string | undefined>;

export interface EnvironmentProfile {
  APP_ENV: AppEnvironment;
  EXPO_PUBLIC_API_URL: string;
  WALLET_CONNECT_PROJECT_ID: string;
  STELLAR_NETWORK: 'mainnet' | 'testnet';
  ENABLE_DEBUG_LOGS: boolean;
  USE_SANDBOX_CONTRACTS: boolean;
}

export const environmentProfiles: Record<AppEnvironment, EnvironmentProfile> = {
  development: {
    APP_ENV: 'development',
    EXPO_PUBLIC_API_URL: 'https://sandbox.api.subtrackr.app',
    WALLET_CONNECT_PROJECT_ID: 'dev-walletconnect-project-id',
    STELLAR_NETWORK: 'testnet',
    ENABLE_DEBUG_LOGS: true,
    USE_SANDBOX_CONTRACTS: true,
  },
  test: {
    APP_ENV: 'test',
    EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3000',
    WALLET_CONNECT_PROJECT_ID: 'test-walletconnect-project-id',
    STELLAR_NETWORK: 'testnet',
    ENABLE_DEBUG_LOGS: false,
    USE_SANDBOX_CONTRACTS: true,
  },
  staging: {
    APP_ENV: 'staging',
    EXPO_PUBLIC_API_URL: 'https://staging.api.subtrackr.app',
    WALLET_CONNECT_PROJECT_ID: 'staging-walletconnect-project-id',
    STELLAR_NETWORK: 'testnet',
    ENABLE_DEBUG_LOGS: true,
    USE_SANDBOX_CONTRACTS: true,
  },
  production: {
    APP_ENV: 'production',
    EXPO_PUBLIC_API_URL: 'https://api.subtrackr.app',
    WALLET_CONNECT_PROJECT_ID: 'production-walletconnect-project-id-required',
    STELLAR_NETWORK: 'mainnet',
    ENABLE_DEBUG_LOGS: false,
    USE_SANDBOX_CONTRACTS: false,
  },
};

const appEnvironmentSchema = z.enum(['development', 'staging', 'production', 'test']);
const optionalSecret = z.string().trim().min(1).optional();

export const envSchema = z
  .object({
    APP_ENV: appEnvironmentSchema.default('development'),
    EXPO_PUBLIC_API_URL: z.string().url('EXPO_PUBLIC_API_URL must be a valid URL'),
    SUBTRACKR_API_KEY: optionalSecret,
    WALLET_CONNECT_PROJECT_ID: z
      .string()
      .trim()
      .min(1, 'WALLET_CONNECT_PROJECT_ID must not be empty'),
    WEBHOOK_SECRET: optionalSecret,
    AUDIT_HMAC_SECRET: optionalSecret,
    STELLAR_MAINNET_PROXY_ID: optionalSecret,
    STELLAR_MAINNET_STORAGE_ID: optionalSecret,
    STELLAR_MAINNET_SUBSCRIPTION_ID: optionalSecret,
    STELLAR_TESTNET_PROXY_ID: optionalSecret,
    STELLAR_TESTNET_STORAGE_ID: optionalSecret,
    STELLAR_TESTNET_SUBSCRIPTION_ID: optionalSecret,
    STELLAR_NETWORK: z.enum(['mainnet', 'testnet']),
    ENABLE_DEBUG_LOGS: z.boolean(),
    USE_SANDBOX_CONTRACTS: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.APP_ENV !== 'production') {
      return;
    }

    if (isPlaceholderWalletConnectProjectId(value.WALLET_CONNECT_PROJECT_ID)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WALLET_CONNECT_PROJECT_ID'],
        message: 'WALLET_CONNECT_PROJECT_ID must be set to a real production project ID',
      });
    }

    const apiUrl = new URL(value.EXPO_PUBLIC_API_URL);
    if (
      apiUrl.hostname.includes('sandbox') ||
      apiUrl.hostname.includes('staging') ||
      apiUrl.hostname === 'localhost' ||
      apiUrl.hostname === '127.0.0.1'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXPO_PUBLIC_API_URL'],
        message: 'Production cannot use sandbox, staging, or localhost API endpoints',
      });
    }

    if (value.USE_SANDBOX_CONTRACTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['USE_SANDBOX_CONTRACTS'],
        message: 'Production must use mainnet contract configuration',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function resolveAppEnvironment(source: EnvSource = process.env): AppEnvironment {
  const explicit = source.APP_ENV;
  if (isAppEnvironment(explicit)) {
    return explicit;
  }

  const nodeEnv = source.NODE_ENV;
  if (isAppEnvironment(nodeEnv)) {
    return nodeEnv;
  }

  return 'development';
}

export function getEnvironmentProfile(environment: AppEnvironment): EnvironmentProfile {
  return { ...environmentProfiles[environment] };
}

export function buildRawEnv(source: EnvSource, APP_ENV: AppEnvironment): Record<string, unknown> {
  const profile = environmentProfiles[APP_ENV];

  return stripUndefined({
    ...profile,
    APP_ENV,
    EXPO_PUBLIC_API_URL: source.EXPO_PUBLIC_API_URL ?? profile.EXPO_PUBLIC_API_URL,
    SUBTRACKR_API_KEY: source.SUBTRACKR_API_KEY,
    WALLET_CONNECT_PROJECT_ID:
      source.WALLET_CONNECT_PROJECT_ID ?? profile.WALLET_CONNECT_PROJECT_ID,
    WEBHOOK_SECRET: source.WEBHOOK_SECRET,
    AUDIT_HMAC_SECRET: source.AUDIT_HMAC_SECRET,
    STELLAR_MAINNET_PROXY_ID: source.STELLAR_MAINNET_PROXY_ID,
    STELLAR_MAINNET_STORAGE_ID: source.STELLAR_MAINNET_STORAGE_ID,
    STELLAR_MAINNET_SUBSCRIPTION_ID: source.STELLAR_MAINNET_SUBSCRIPTION_ID,
    STELLAR_TESTNET_PROXY_ID: source.STELLAR_TESTNET_PROXY_ID,
    STELLAR_TESTNET_STORAGE_ID: source.STELLAR_TESTNET_STORAGE_ID,
    STELLAR_TESTNET_SUBSCRIPTION_ID: source.STELLAR_TESTNET_SUBSCRIPTION_ID,
    STELLAR_NETWORK:
      (source.STELLAR_NETWORK as EnvironmentProfile['STELLAR_NETWORK'] | undefined) ??
      profile.STELLAR_NETWORK,
    ENABLE_DEBUG_LOGS: parseBoolean(source.ENABLE_DEBUG_LOGS, profile.ENABLE_DEBUG_LOGS),
    USE_SANDBOX_CONTRACTS: parseBoolean(
      source.USE_SANDBOX_CONTRACTS,
      profile.USE_SANDBOX_CONTRACTS
    ),
  });
}

export function loadEnvironmentConfig(
  source: EnvSource = process.env,
  overrideEnv?: AppEnvironment
): Env {
  const APP_ENV = overrideEnv ?? resolveAppEnvironment(source);
  return envSchema.parse(buildRawEnv(source, APP_ENV));
}

/**
 * Validate app environment variables once at startup.
 *
 * Production refuses to start with invalid configuration. Non-production builds
 * warn and continue with the selected profile defaults so local work is not
 * blocked by a half-populated shell environment.
 */
export function validateEnv(source: EnvSource = process.env, overrideEnv?: AppEnvironment): Env {
  const APP_ENV = overrideEnv ?? resolveAppEnvironment(source);
  const result = envSchema.safeParse(buildRawEnv(source, APP_ENV));

  if (!result.success) {
    const message = formatEnvIssues(result.error.issues);

    if (APP_ENV === 'production') {
      throw new Error(message);
    }

    // eslint-disable-next-line no-console
    console.warn(message);
    return loadEnvironmentConfig({}, APP_ENV);
  }

  const isReactNativeDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (isReactNativeDev && result.data.ENABLE_DEBUG_LOGS) {
    // eslint-disable-next-line no-console
    console.info('[SubTrackr] Environment validated successfully', {
      APP_ENV: result.data.APP_ENV,
      EXPO_PUBLIC_API_URL: result.data.EXPO_PUBLIC_API_URL,
      STELLAR_NETWORK: result.data.STELLAR_NETWORK,
    });
  }

  return result.data;
}

export const env: Env = validateEnv();

function isAppEnvironment(value: unknown): value is AppEnvironment {
  return (
    value === 'development' || value === 'staging' || value === 'production' || value === 'test'
  );
}

function isPlaceholderWalletConnectProjectId(value: string): boolean {
  return /^(YOUR_PROJECT_ID|dev-|test-|staging-|production-walletconnect-project-id-required)/.test(
    value
  );
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (/^(1|true|yes)$/i.test(value)) return true;
  if (/^(0|false|no)$/i.test(value)) return false;
  return fallback;
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function formatEnvIssues(issues: z.ZodIssue[]): string {
  return [
    '[SubTrackr] Environment validation failed:',
    ...issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`),
  ].join('\n');
}
