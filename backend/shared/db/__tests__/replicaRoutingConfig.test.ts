import {
  DEFAULT_ROUTING_CONFIG,
  loadRoutingConfig,
  shouldPinToPrimary,
  mergeRoutingConfig,
  type ReplicaRoutingConfig,
  type RoutingOverride,
} from '../replicaRoutingConfig';

describe('replicaRoutingConfig', () => {
  describe('DEFAULT_ROUTING_CONFIG', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_ROUTING_CONFIG.enabled).toBe(true);
      expect(DEFAULT_ROUTING_CONFIG.strategy).toBe('round-robin');
      expect(DEFAULT_ROUTING_CONFIG.minReplicas).toBe(1);
      expect(DEFAULT_ROUTING_CONFIG.maxLagMs).toBe(5_000);
      expect(DEFAULT_ROUTING_CONFIG.debugHeaders).toBe(false);
    });

    it('pins locking reads to primary', () => {
      expect(DEFAULT_ROUTING_CONFIG.primaryPinnedPatterns.length).toBeGreaterThan(0);
    });
  });

  describe('loadRoutingConfig', () => {
    it('loads defaults when env is empty', () => {
      const config = loadRoutingConfig({});
      expect(config.enabled).toBe(true);
      expect(config.strategy).toBe('round-robin');
      expect(config.minReplicas).toBe(1);
      expect(config.maxLagMs).toBe(5_000);
    });

    it('disables routing when DB_ROUTING_ENABLED is false', () => {
      const config = loadRoutingConfig({ DB_ROUTING_ENABLED: 'false' });
      expect(config.enabled).toBe(false);
    });

    it('loads custom strategy', () => {
      expect(loadRoutingConfig({ DB_ROUTING_STRATEGY: 'least-lag' }).strategy).toBe('least-lag');
      expect(loadRoutingConfig({ DB_ROUTING_STRATEGY: 'random' }).strategy).toBe('random');
    });

    it('falls back for invalid strategy', () => {
      expect(loadRoutingConfig({ DB_ROUTING_STRATEGY: 'invalid' }).strategy).toBe('round-robin');
    });

    it('loads custom min replicas and max lag', () => {
      const config = loadRoutingConfig({
        DB_ROUTING_MIN_REPLICAS: '2',
        DB_ROUTING_MAX_LAG_MS: '3000',
      });
      expect(config.minReplicas).toBe(2);
      expect(config.maxLagMs).toBe(3_000);
    });

    it('enables debug headers', () => {
      expect(loadRoutingConfig({ DB_ROUTING_DEBUG_HEADERS: 'true' }).debugHeaders).toBe(true);
    });
  });

  describe('shouldPinToPrimary', () => {
    const config = DEFAULT_ROUTING_CONFIG;

    it('pins SELECT FOR UPDATE to primary', () => {
      expect(shouldPinToPrimary('SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE', config)).toBe(true);
    });

    it('pins NEXTVAL to primary', () => {
      expect(shouldPinToPrimary('SELECT NEXTVAL(\'seq_id\')', config)).toBe(true);
    });

    it('pins pg_advisory_lock to primary', () => {
      expect(shouldPinToPrimary('SELECT pg_advisory_lock(12345)', config)).toBe(true);
    });

    it('does not pin regular SELECT to primary', () => {
      expect(shouldPinToPrimary('SELECT * FROM subscriptions WHERE id = $1', config)).toBe(false);
    });

    it('does not pin INSERT to primary (writes go to primary anyway)', () => {
      expect(shouldPinToPrimary('INSERT INTO subscriptions VALUES ($1)', config)).toBe(false);
    });
  });

  describe('mergeRoutingConfig', () => {
    it('returns base config when no override', () => {
      const merged = mergeRoutingConfig(DEFAULT_ROUTING_CONFIG);
      expect(merged).toEqual(DEFAULT_ROUTING_CONFIG);
    });

    it('disables routing when forcePrimary is set', () => {
      const override: RoutingOverride = { forcePrimary: true };
      const merged = mergeRoutingConfig(DEFAULT_ROUTING_CONFIG, override);
      expect(merged.enabled).toBe(false);
    });

    it('overrides strategy', () => {
      const override: RoutingOverride = { strategy: 'least-lag' };
      const merged = mergeRoutingConfig(DEFAULT_ROUTING_CONFIG, override);
      expect(merged.strategy).toBe('least-lag');
    });

    it('overrides max lag', () => {
      const override: RoutingOverride = { maxLagMs: 1_000 };
      const merged = mergeRoutingConfig(DEFAULT_ROUTING_CONFIG, override);
      expect(merged.maxLagMs).toBe(1_000);
    });

    it('preserves base when override is empty object', () => {
      const merged = mergeRoutingConfig(DEFAULT_ROUTING_CONFIG, {});
      expect(merged.enabled).toBe(true);
      expect(merged.strategy).toBe('round-robin');
    });
  });
});
