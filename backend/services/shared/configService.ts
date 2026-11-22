import { z } from 'zod';

export type Environment = 'development' | 'staging' | 'production' | 'test';
export type EnvSource = Record<string, string | undefined>;

export interface BackendEnvironmentProfile {
  env: Environment;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  awsRegion: string;
  secretsProvider: 'local' | 'aws';
  requireManagedSecrets: boolean;
}

export const backendEnvironmentProfiles: Record<Environment, BackendEnvironmentProfile> = {
  development: {
    env: 'development',
    port: 3000,
    databaseUrl: 'postgresql://localhost:5432/subtrackr',
    redisUrl: 'redis://localhost:6379',
    jwtSecret: 'dev-jwt-secret-key-change-in-prod',
    awsRegion: 'us-east-1',
    secretsProvider: 'local',
    requireManagedSecrets: false,
  },
  test: {
    env: 'test',
    port: 3001,
    databaseUrl: 'postgresql://localhost:5432/subtrackr_test',
    redisUrl: 'redis://localhost:6379/1',
    jwtSecret: 'test-jwt-secret-key',
    awsRegion: 'us-east-1',
    secretsProvider: 'local',
    requireManagedSecrets: false,
  },
  staging: {
    env: 'staging',
    port: 3000,
    databaseUrl: 'postgresql://staging-db.subtrackr.internal:5432/subtrackr',
    redisUrl: 'redis://staging-redis.subtrackr.internal:6379',
    jwtSecret: 'staging-jwt-secret-key',
    awsRegion: 'us-east-1',
    secretsProvider: 'aws',
    requireManagedSecrets: true,
  },
  production: {
    env: 'production',
    port: 8080,
    databaseUrl: 'postgresql://prod-db.subtrackr.internal:5432/subtrackr',
    redisUrl: 'redis://prod-redis.subtrackr.internal:6379',
    jwtSecret: 'production-jwt-secret-required',
    awsRegion: 'us-east-1',
    secretsProvider: 'aws',
    requireManagedSecrets: true,
  },
};

export const backendConfigSchema = z
  .object({
    env: z.enum(['development', 'staging', 'production', 'test']).default('development'),
    port: z.number().int().positive().default(3000),
    databaseUrl: z.string().min(1),
    redisUrl: z.string().min(1),
    jwtSecret: z.string().min(12),
    awsRegion: z.string().min(1).default('us-east-1'),
    secretManagerSecretId: z.string().trim().min(1).optional(),
    secretsProvider: z.enum(['local', 'aws']).default('local'),
    requireManagedSecrets: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.env !== 'production') {
      return;
    }

    if (value.jwtSecret === backendEnvironmentProfiles.production.jwtSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['jwtSecret'],
        message: 'JWT_SECRET must be provided for production',
      });
    }

    if (value.databaseUrl.includes('localhost') || value.databaseUrl.includes('127.0.0.1')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['databaseUrl'],
        message: 'Production DATABASE_URL cannot point at localhost',
      });
    }

    if (value.redisUrl.includes('localhost') || value.redisUrl.includes('127.0.0.1')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['redisUrl'],
        message: 'Production REDIS_URL cannot point at localhost',
      });
    }

    if (value.requireManagedSecrets && !value.secretManagerSecretId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secretManagerSecretId'],
        message: 'AWS_SECRET_ID must be set when managed secrets are required',
      });
    }
  });

export type BackendConfig = z.infer<typeof backendConfigSchema>;

export class ConfigService {
  private static instance: ConfigService;
  private currentConfig: BackendConfig;
  private readonly envSource: EnvSource;
  private secretsCache: Map<string, string> = new Map();

  constructor(envSource: EnvSource = process.env, overrideEnv?: Environment) {
    this.envSource = envSource;
    this.currentConfig = this.loadEnvironmentConfig(overrideEnv);
  }

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  public static fromEnv(envSource: EnvSource, overrideEnv?: Environment): ConfigService {
    return new ConfigService(envSource, overrideEnv);
  }

  public getEnvironmentProfile(environment: Environment): BackendEnvironmentProfile {
    return { ...backendEnvironmentProfiles[environment] };
  }

  public loadEnvironmentConfig(overrideEnv?: Environment, envSource = this.envSource): BackendConfig {
    const targetEnv = overrideEnv || resolveBackendEnvironment(envSource);
    const profile = backendEnvironmentProfiles[targetEnv];
    const raw = {
      ...profile,
      env: targetEnv,
      port: parseNumber(envSource.PORT, profile.port),
      databaseUrl: envSource.DATABASE_URL ?? profile.databaseUrl,
      redisUrl: envSource.REDIS_URL ?? profile.redisUrl,
      jwtSecret: envSource.JWT_SECRET ?? profile.jwtSecret,
      awsRegion: envSource.AWS_REGION ?? profile.awsRegion,
      secretManagerSecretId: envSource.AWS_SECRET_ID,
      secretsProvider:
        (envSource.SECRETS_PROVIDER as BackendEnvironmentProfile['secretsProvider'] | undefined) ??
        profile.secretsProvider,
      requireManagedSecrets: parseBoolean(
        envSource.REQUIRE_MANAGED_SECRETS,
        profile.requireManagedSecrets
      ),
    };

    return backendConfigSchema.parse(stripUndefined(raw));
  }

  public getConfig(): BackendConfig {
    return { ...this.currentConfig };
  }

  public async fetchSecretFromAws(secretName: string): Promise<string | null> {
    if (this.secretsCache.has(secretName)) {
      return this.secretsCache.get(secretName)!;
    }

    const shouldUseAws =
      this.currentConfig.secretsProvider === 'aws' ||
      this.currentConfig.secretManagerSecretId !== undefined ||
      this.envSource.USE_AWS_SECRETS === 'true';

    if (shouldUseAws) {
      const mockSecret = `aws-secret-value-for-${secretName}`;
      this.secretsCache.set(secretName, mockSecret);
      return mockSecret;
    }

    return null;
  }

  public refreshConfig(overrideEnv?: Environment): BackendConfig {
    this.currentConfig = this.loadEnvironmentConfig(overrideEnv);
    this.secretsCache.clear();
    return this.getConfig();
  }

  public compareConfigs(
    configA: Partial<BackendConfig>,
    configB: Partial<BackendConfig>
  ): Array<{ key: string; a: unknown; b: unknown }> {
    const diffs: Array<{ key: string; a: unknown; b: unknown }> = [];
    const allKeys = new Set([...Object.keys(configA), ...Object.keys(configB)]);
    for (const key of allKeys) {
      const valA = (configA as Record<string, unknown>)[key];
      const valB = (configB as Record<string, unknown>)[key];
      if (valA !== valB) {
        diffs.push({ key, a: valA, b: valB });
      }
    }
    return diffs;
  }

  public detectDrift(
    expectedConfig: BackendConfig
  ): Array<{ key: string; expected: unknown; actual: unknown }> {
    const current = this.getConfig();
    const drift: Array<{ key: string; expected: unknown; actual: unknown }> = [];
    for (const key of Object.keys(expectedConfig) as Array<keyof BackendConfig>) {
      if (expectedConfig[key] !== current[key]) {
        drift.push({ key, expected: expectedConfig[key], actual: current[key] });
      }
    }
    return drift;
  }
}

export function resolveBackendEnvironment(source: EnvSource = process.env): Environment {
  if (isEnvironment(source.APP_ENV)) {
    return source.APP_ENV;
  }
  if (isEnvironment(source.NODE_ENV)) {
    return source.NODE_ENV;
  }
  return 'development';
}

function isEnvironment(value: unknown): value is Environment {
  return (
    value === 'development' || value === 'staging' || value === 'production' || value === 'test'
  );
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

export const configService = ConfigService.getInstance();
