import { ConfigService, configService } from '../configService';

describe('ConfigService', () => {
  it('loads default environment configuration', () => {
    const config = configService.getConfig();
    expect(config).toBeDefined();
    expect(config.env).toBeDefined();
    expect(config.port).toBeGreaterThan(0);
  });

  it('compares configurations accurately', () => {
    const configA = { port: 3000, env: 'development' as const };
    const configB = { port: 8080, env: 'development' as const };
    const diffs = configService.compareConfigs(configA, configB);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe('port');
  });

  it('detects config drift', () => {
    const expected = {
      env: 'production' as const,
      port: 9000,
      databaseUrl: 'postgresql://prod:5432/db',
      redisUrl: 'redis://prod:6379',
      jwtSecret: 'prod-secret',
      awsRegion: 'us-west-2',
    };
    const drift = configService.detectDrift(expected);
    expect(drift.length).toBeGreaterThan(0);
  });

  it('refreshes configuration', () => {
    const refreshed = configService.refreshConfig();
    expect(refreshed).toBeDefined();
  });
});
