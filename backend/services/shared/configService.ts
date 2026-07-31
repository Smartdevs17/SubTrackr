import { z } from 'zod';

export type Environment = 'development' | 'staging' | 'production' | 'test';

export const backendConfigSchema = z.object({
  env: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  port: z.number().default(3000),
  databaseUrl: z.string().default('postgresql://localhost:5432/subtrackr'),
  redisUrl: z.string().default('redis://localhost:6379'),
  jwtSecret: z.string().default('dev-jwt-secret-key-change-in-prod'),
  awsRegion: z.string().default('us-east-1'),
  secretManagerSecretId: z.string().optional(),
});

export type BackendConfig = z.infer<typeof backendConfigSchema>;

export class ConfigService {
  private static instance: ConfigService;
  private currentConfig: BackendConfig;
  private secretsCache: Map<string, string> = new Map();

  private constructor() {
    this.currentConfig = this.loadEnvironmentConfig();
  }

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  public loadEnvironmentConfig(overrideEnv?: Environment): BackendConfig {
    const targetEnv = overrideEnv || (process.env.NODE_ENV as Environment) || 'development';
    const raw = {
      env: targetEnv,
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
      databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/subtrackr',
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-key-change-in-prod',
      awsRegion: process.env.AWS_REGION || 'us-east-1',
      secretManagerSecretId: process.env.AWS_SECRET_ID,
    };

    return backendConfigSchema.parse(raw);
  }

  public getConfig(): BackendConfig {
    return { ...this.currentConfig };
  }

  public async fetchSecretFromAws(secretName: string): Promise<string | null> {
    if (this.secretsCache.has(secretName)) {
      return this.secretsCache.get(secretName)!;
    }
    if (process.env.AWS_SECRET_ID || process.env.USE_AWS_SECRETS === 'true') {
      const mockSecret = `aws-secret-value-for-${secretName}`;
      this.secretsCache.set(secretName, mockSecret);
      return mockSecret;
    }
    return null;
  }

  public refreshConfig(): BackendConfig {
    this.currentConfig = this.loadEnvironmentConfig();
    this.secretsCache.clear();
    return this.getConfig();
  }

  public compareConfigs(
    configA: Partial<BackendConfig>,
    configB: Partial<BackendConfig>
  ): Array<{ key: string; a: any; b: any }> {
    const diffs: Array<{ key: string; a: any; b: any }> = [];
    const allKeys = new Set([...Object.keys(configA), ...Object.keys(configB)]);
    for (const key of allKeys) {
      const valA = (configA as any)[key];
      const valB = (configB as any)[key];
      if (valA !== valB) {
        diffs.push({ key, a: valA, b: valB });
      }
    }
    return diffs;
  }

  public detectDrift(
    expectedConfig: BackendConfig
  ): Array<{ key: string; expected: any; actual: any }> {
    const current = this.getConfig();
    const drift: Array<{ key: string; expected: any; actual: any }> = [];
    for (const key of Object.keys(expectedConfig) as Array<keyof BackendConfig>) {
      if (expectedConfig[key] !== current[key]) {
        drift.push({ key, expected: expectedConfig[key], actual: current[key] });
      }
    }
    return drift;
  }
}

export const configService = ConfigService.getInstance();
