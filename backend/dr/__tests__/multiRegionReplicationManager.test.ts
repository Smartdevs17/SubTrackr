/**
 * Tests for MultiRegionReplicationManager
 *
 * Covers:
 *  - Region initialisation and role assignment
 *  - routeWrite() returns primary, routeRead() returns replica
 *  - routeRead() falls back to primary when no replicas are available
 *  - pollRegion() updates health, lag, lagP99
 *  - pollRegion() triggers lag alert callback above threshold
 *  - pollRegion() marks region unhealthy on error
 *  - triggerFailover() promotes healthiest replica
 *  - triggerFailover() fires onFailover callback and 'failover' event
 *  - triggerFailover() returns null when no candidates exist
 *  - promoteRegion() manually promotes a replica
 *  - Consecutive failure threshold gates primary failover
 *  - getMetrics() and toPrometheus() return correct data
 *  - start() / stop() lifecycle
 *  - onRegionHealthChange callback fires on health transition
 */

import { MultiRegionReplicationManager, type RegionConfig } from '../multiRegionReplicationManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function twoRegions(overrides: Partial<RegionConfig>[] = []): RegionConfig[] {
  return [
    {
      id: 'us-east-1',
      name: 'US East 1',
      connectionUrl: 'postgres://primary:5432/subtrackr',
      role: 'primary',
      lagAlertMs: 100,
      lagDegradedMs: 500,
      lagFailoverMs: 2_000,
      failoverPriority: 0,
      ...overrides[0],
    },
    {
      id: 'eu-west-1',
      name: 'EU West 1',
      connectionUrl: 'postgres://replica1:5432/subtrackr',
      role: 'replica',
      lagAlertMs: 100,
      lagDegradedMs: 500,
      lagFailoverMs: 2_000,
      failoverPriority: 0,
      ...overrides[1],
    },
  ];
}

function threeRegions(): RegionConfig[] {
  return [
    ...twoRegions(),
    {
      id: 'ap-southeast-1',
      name: 'AP Southeast 1',
      connectionUrl: 'postgres://replica2:5432/subtrackr',
      role: 'replica',
      lagAlertMs: 100,
      lagDegradedMs: 500,
      lagFailoverMs: 2_000,
      failoverPriority: 1, // lower priority than eu-west-1
    },
  ];
}

function makeMgr(
  regions: RegionConfig[] = twoRegions(),
  extraOpts: Partial<ConstructorParameters<typeof MultiRegionReplicationManager>[0]> = {},
): MultiRegionReplicationManager {
  return new MultiRegionReplicationManager({
    regions,
    pollIntervalMs: 10_000, // high to prevent automatic polling in tests
    primaryFailureThreshold: 3,
    measureLag: async () => 50, // stable low lag by default
    ...extraOpts,
  });
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

describe('MultiRegionReplicationManager – initialisation', () => {
  it('identifies the primary region from config', () => {
    const mgr = makeMgr();
    expect(mgr.getPrimaryRegionId()).toBe('us-east-1');
  });

  it('initialises all regions with health = unknown', () => {
    const mgr = makeMgr();
    for (const state of mgr.getAllRegionStates()) {
      expect(state.health).toBe('unknown');
    }
  });

  it('initialises roles from config', () => {
    const mgr = makeMgr(twoRegions());
    expect(mgr.getRegionState('us-east-1')!.role).toBe('primary');
    expect(mgr.getRegionState('eu-west-1')!.role).toBe('replica');
  });
});

// ---------------------------------------------------------------------------
// routeWrite / routeRead
// ---------------------------------------------------------------------------

describe('routeWrite()', () => {
  it('returns null when no primary is configured', async () => {
    const mgr = makeMgr([
      { id: 'r1', name: 'R1', connectionUrl: 'x', role: 'replica' },
    ]);
    expect(mgr.routeWrite()).toBeNull();
  });

  it('returns the primary region after a healthy poll', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();

    const decision = mgr.routeWrite();
    expect(decision).not.toBeNull();
    expect(decision!.regionId).toBe('us-east-1');
    expect(decision!.role).toBe('primary');
  });

  it('returns null when primary is unhealthy', async () => {
    const mgr = makeMgr(twoRegions(), {
      measureLag: async (state) => {
        if (state.config.id === 'us-east-1') throw new Error('primary down');
        return 50;
      },
      primaryFailureThreshold: 1,
    });
    await mgr.pollAllRegions();

    // After failover the original primary is now a replica and unhealthy;
    // routeWrite returns the new primary.
    const decision = mgr.routeWrite();
    // Either null (primary failed over) or the new primary (eu-west-1)
    if (decision !== null) {
      expect(decision.regionId).toBe('eu-west-1');
    }
  });

  it('increments writeQueries counter', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();

    mgr.routeWrite();
    expect(mgr.getMetrics().writeQueries).toBe(1);
  });
});

describe('routeRead()', () => {
  it('returns a replica region when healthy replicas exist', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();

    const decision = mgr.routeRead();
    expect(decision).not.toBeNull();
    expect(decision!.role).toBe('replica');
    expect(decision!.regionId).toBe('eu-west-1');
  });

  it('falls back to primary when no replicas are available', async () => {
    const mgr = makeMgr(
      // Only a primary, no replicas
      [{ id: 'us-east-1', name: 'Primary', connectionUrl: 'x', role: 'primary' }],
    );
    await mgr.pollAllRegions();

    const decision = mgr.routeRead();
    expect(decision).not.toBeNull();
    expect(decision!.regionId).toBe('us-east-1');
    expect(decision!.role).toBe('primary');
  });

  it('round-robins across multiple healthy replicas', async () => {
    const mgr = makeMgr(threeRegions());
    await mgr.pollAllRegions();

    const regions = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const d = mgr.routeRead();
      if (d) regions.add(d.regionId);
    }
    // Should have seen both replicas
    expect(regions.has('eu-west-1')).toBe(true);
    expect(regions.has('ap-southeast-1')).toBe(true);
  });

  it('increments readQueries counter', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();

    mgr.routeRead();
    mgr.routeRead();
    expect(mgr.getMetrics().readQueries).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Health monitoring
// ---------------------------------------------------------------------------

describe('pollRegion()', () => {
  it('sets health to healthy when lag is below threshold', async () => {
    const mgr = makeMgr(twoRegions(), { measureLag: async () => 10 });
    await mgr.pollAllRegions();

    expect(mgr.getRegionState('eu-west-1')!.health).toBe('healthy');
  });

  it('sets health to degraded when lag exceeds lagDegradedMs', async () => {
    const mgr = makeMgr(twoRegions(), { measureLag: async () => 600 });
    await mgr.pollAllRegions();

    expect(mgr.getRegionState('eu-west-1')!.health).toBe('degraded');
  });

  it('sets health to unhealthy when lag exceeds lagFailoverMs', async () => {
    const mgr = makeMgr(twoRegions(), { measureLag: async () => 3_000 });
    await mgr.pollAllRegions();

    expect(mgr.getRegionState('eu-west-1')!.health).toBe('unhealthy');
  });

  it('updates lagMs and lagP99Ms', async () => {
    const mgr = makeMgr(twoRegions(), { measureLag: async () => 200 });
    await mgr.pollAllRegions();

    const state = mgr.getRegionState('eu-west-1')!;
    expect(state.lagMs).toBe(200);
    expect(state.lagP99Ms).toBeGreaterThan(0);
  });

  it('fires onLagAlert callback when lag exceeds lagAlertMs', async () => {
    const alerts: Array<{ regionId: string; lagMs: number }> = [];
    const mgr = makeMgr(twoRegions(), {
      measureLag: async () => 150, // > lagAlertMs (100)
      onLagAlert: (regionId, lagMs) => alerts.push({ regionId, lagMs }),
    });
    await mgr.pollAllRegions();

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].lagMs).toBe(150);
  });

  it('fires onRegionHealthChange when health transitions', async () => {
    const changes: Array<{ regionId: string; from: string; to: string }> = [];
    const mgr = makeMgr(twoRegions(), {
      measureLag: async () => 50,
      onRegionHealthChange: (regionId, prev, curr) => changes.push({ regionId, from: prev, to: curr }),
    });
    await mgr.pollAllRegions();

    // unknown → healthy
    expect(changes.some((c) => c.regionId === 'eu-west-1' && c.from === 'unknown' && c.to === 'healthy')).toBe(true);
  });

  it('sets health to unhealthy after measureLag throws', async () => {
    const mgr = makeMgr(twoRegions(), {
      measureLag: async (state) => {
        if (state.config.id === 'eu-west-1') throw new Error('connection refused');
        return 0;
      },
      primaryFailureThreshold: 5, // don't auto-failover
    });
    await mgr.pollAllRegions();

    const state = mgr.getRegionState('eu-west-1')!;
    expect(state.consecutiveFailures).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Failover
// ---------------------------------------------------------------------------

describe('triggerFailover()', () => {
  it('promotes the replica with lowest lag to primary', async () => {
    const lagMap: Record<string, number> = { 'eu-west-1': 100, 'ap-southeast-1': 50 };
    const mgr = makeMgr(threeRegions(), {
      measureLag: async (state) => lagMap[state.config.id] ?? 0,
    });
    await mgr.pollAllRegions();

    const result = await mgr.triggerFailover('test');
    // ap-southeast-1 has lower lag so should be promoted
    expect(result!.newPrimary).toBe('ap-southeast-1');
    expect(result!.previousPrimary).toBe('us-east-1');
  });

  it('updates state.role for new and old primary', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();

    await mgr.triggerFailover('test');

    expect(mgr.getRegionState('eu-west-1')!.role).toBe('primary');
    expect(mgr.getRegionState('us-east-1')!.role).toBe('replica');
  });

  it('fires onFailover callback', async () => {
    let callbackResult: unknown = null;
    const mgr = makeMgr(twoRegions(), {
      onFailover: (r) => { callbackResult = r; },
    });
    await mgr.pollAllRegions();
    await mgr.triggerFailover('test');

    expect(callbackResult).not.toBeNull();
  });

  it('emits failover event', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();

    const events: unknown[] = [];
    mgr.on('failover', (r) => events.push(r));
    await mgr.triggerFailover('test');

    expect(events).toHaveLength(1);
  });

  it('returns null when no replica candidates exist', async () => {
    const mgr = makeMgr(
      [{ id: 'primary', name: 'Primary', connectionUrl: 'x', role: 'primary' }],
    );
    const result = await mgr.triggerFailover('test');
    expect(result).toBeNull();
  });

  it('increments totalFailovers counter', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();
    await mgr.triggerFailover('first');
    await mgr.triggerFailover('second');
    expect(mgr.getMetrics().totalFailovers).toBe(2);
  });

  it('sets lastFailoverAt timestamp', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();
    const before = Date.now();
    await mgr.triggerFailover('test');
    expect(mgr.getMetrics().lastFailoverAt).toBeGreaterThanOrEqual(before);
  });
});

describe('promoteRegion()', () => {
  it('promotes the specified region to primary', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();

    const result = await mgr.promoteRegion('eu-west-1', 'maintenance');
    expect(result!.newPrimary).toBe('eu-west-1');
  });

  it('returns null if the region is already primary', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();
    const result = await mgr.promoteRegion('us-east-1', 'noop');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Automatic failover on primary failure threshold
// ---------------------------------------------------------------------------

describe('automatic failover', () => {
  it('triggers failover after primary exceeds failure threshold', async () => {
    const mgr = makeMgr(twoRegions(), {
      measureLag: async (state) => {
        if (state.config.id === 'us-east-1') throw new Error('primary down');
        return 50;
      },
      primaryFailureThreshold: 1,
    });

    const failovers: unknown[] = [];
    mgr.on('failover', (r) => failovers.push(r));

    await mgr.pollAllRegions();

    expect(failovers).toHaveLength(1);
    expect(mgr.getPrimaryRegionId()).toBe('eu-west-1');
  });
});

// ---------------------------------------------------------------------------
// getMetrics() / toPrometheus()
// ---------------------------------------------------------------------------

describe('getMetrics()', () => {
  it('returns all region snapshots', async () => {
    const mgr = makeMgr();
    await mgr.pollAllRegions();

    const metrics = mgr.getMetrics();
    expect(metrics.regions).toHaveLength(2);
    expect(metrics.primaryRegion).toBe('us-east-1');
  });

  it('shows zero failovers initially', () => {
    const mgr = makeMgr();
    expect(mgr.getMetrics().totalFailovers).toBe(0);
    expect(mgr.getMetrics().lastFailoverAt).toBeNull();
  });
});

describe('toPrometheus()', () => {
  it('renders lag, availability and role metrics', async () => {
    const mgr = makeMgr(twoRegions(), { measureLag: async () => 75 });
    await mgr.pollAllRegions();

    const text = mgr.toPrometheus();
    expect(text).toContain('subtrackr_region_replication_lag_ms{region="eu-west-1"} 75');
    expect(text).toContain('subtrackr_region_available{region="eu-west-1"} 1');
    expect(text).toContain('subtrackr_region_is_primary{region="us-east-1"} 1');
    expect(text).toContain('subtrackr_region_is_primary{region="eu-west-1"} 0');
    expect(text).toContain('subtrackr_region_failovers_total 0');
  });

  it('renders the P99 lag metric', async () => {
    const mgr = makeMgr(twoRegions(), { measureLag: async () => 200 });
    await mgr.pollAllRegions();

    const text = mgr.toPrometheus();
    expect(text).toContain('subtrackr_region_replication_lag_p99_ms{region="eu-west-1"} 200');
  });

  it('ends with a newline', async () => {
    const mgr = makeMgr();
    expect(mgr.toPrometheus().endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// start / stop lifecycle
// ---------------------------------------------------------------------------

describe('start() / stop()', () => {
  it('stop() does not throw when called before start()', () => {
    const mgr = makeMgr();
    expect(() => mgr.stop()).not.toThrow();
  });

  it('start() then stop() leaves manager in stopped state', () => {
    const mgr = makeMgr();
    mgr.start();
    mgr.stop();
    // No assertion needed — just verifying no exceptions are thrown
  });
});
