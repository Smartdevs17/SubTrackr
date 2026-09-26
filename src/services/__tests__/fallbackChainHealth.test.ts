/**
 * Tests for Issue #922 — Payment method fallback chain health monitoring
 * and smart fallback selection.
 */

import {
  FallbackChainHealthMonitor,
  SmartFallbackSelector,
  buildFallbackChainDiagnosticReport,
  type PaymentMethodRotationPolicy,
  type FallbackChainHealthSnapshot,
} from '../../../src/services/walletService';

// ── Helpers ──────────────────────────────────────────────────────────────

const makeAttempt = (
  methodId: string,
  success: boolean,
  daysAgo = 0,
  latencyMs?: number
) => ({
  paymentMethodId: methodId,
  success,
  timestamp: new Date(Date.now() - daysAgo * 86_400_000),
  latencyMs,
});

// ── FallbackChainHealthMonitor ────────────────────────────────────────────

describe('FallbackChainHealthMonitor', () => {
  let monitor: FallbackChainHealthMonitor;

  beforeEach(() => {
    // Each test gets a fresh instance via the static accessor.
    monitor = FallbackChainHealthMonitor.getInstance();
  });

  it('should return green status when all methods are healthy', () => {
    const attempts = [
      makeAttempt('m1', true),
      makeAttempt('m1', true),
      makeAttempt('m2', true),
      makeAttempt('m2', true),
    ];

    const snapshot = monitor.snapshotChainHealth('chain1', ['m1', 'm2'], attempts);

    expect(snapshot.overallStatus).toBe('green');
    expect(snapshot.methods).toHaveLength(2);
    snapshot.methods.forEach((m) => {
      expect(m.healthy).toBe(true);
      expect(m.successRate).toBe(1);
    });
  });

  it('should mark a method unhealthy after 3 consecutive failures', () => {
    const attempts = [
      makeAttempt('m1', false), // most recent first
      makeAttempt('m1', false),
      makeAttempt('m1', false),
      makeAttempt('m1', true), // older success
    ];

    const snapshot = monitor.snapshotChainHealth('chain1', ['m1'], attempts);
    const m1 = snapshot.methods.find((m) => m.methodId === 'm1')!;

    expect(m1.healthy).toBe(false);
    expect(m1.consecutiveFailures).toBe(3);
  });

  it('should report yellow status when some methods are unhealthy', () => {
    const attempts = [
      makeAttempt('m1', true),
      makeAttempt('m2', false),
      makeAttempt('m2', false),
      makeAttempt('m2', false),
    ];

    const snapshot = monitor.snapshotChainHealth('chain1', ['m1', 'm2'], attempts);

    expect(snapshot.overallStatus).toBe('yellow');
  });

  it('should report red status when all methods are unhealthy', () => {
    const makeTriple = (id: string) => [
      makeAttempt(id, false),
      makeAttempt(id, false),
      makeAttempt(id, false),
    ];
    const attempts = [...makeTriple('m1'), ...makeTriple('m2')];

    const snapshot = monitor.snapshotChainHealth('chain1', ['m1', 'm2'], attempts);

    expect(snapshot.overallStatus).toBe('red');
  });

  it('should compute average latency correctly', () => {
    const attempts = [
      makeAttempt('m1', true, 0, 100),
      makeAttempt('m1', true, 0, 300),
    ];

    const snapshot = monitor.snapshotChainHealth('chain1', ['m1'], attempts);
    const m1 = snapshot.methods[0];

    expect(m1.avgLatencyMs).toBe(200);
  });

  it('should record zero latency when no latency data is available', () => {
    const attempts = [makeAttempt('m1', true, 0, undefined)];
    const snapshot = monitor.snapshotChainHealth('chain1', ['m1'], attempts);
    expect(snapshot.methods[0].avgLatencyMs).toBe(0);
  });

  it('should treat new methods with no history as healthy', () => {
    const snapshot = monitor.snapshotChainHealth('chain1', ['m_new'], []);
    expect(snapshot.methods[0].healthy).toBe(true);
    expect(snapshot.methods[0].successRate).toBe(1);
  });

  it('should ignore attempts outside the look-back window', () => {
    const attempts = [
      makeAttempt('m1', false, 2, undefined), // 2 days ago — outside 24 h window
      makeAttempt('m1', false, 2, undefined),
      makeAttempt('m1', false, 2, undefined),
    ];

    // 24 h window (86_400_000 ms default).
    const snapshot = monitor.snapshotChainHealth('chain1', ['m1'], attempts);
    // No attempts in window → treated as 100 % success.
    expect(snapshot.methods[0].healthy).toBe(true);
  });

  // ── Rotation policy ──────────────────────────────────────────────────

  it('should promote a backup when the primary exceeds the failure threshold', () => {
    const policy: PaymentMethodRotationPolicy = {
      chainId: 'chain1',
      failureThreshold: 2,
      cooldownMs: 60_000,
      enabled: true,
      activePromotedMethodId: null,
      promotedAt: null,
    };

    // Primary (m1) has 3 consecutive failures; m2 is healthy.
    const snapshot: FallbackChainHealthSnapshot = {
      chainId: 'chain1',
      checkedAt: new Date().toISOString(),
      overallStatus: 'yellow',
      methods: [
        { methodId: 'm1', successRate: 0.2, avgLatencyMs: 0, healthy: false, lastSuccessAt: null, consecutiveFailures: 3 },
        { methodId: 'm2', successRate: 1, avgLatencyMs: 0, healthy: true, lastSuccessAt: new Date().toISOString(), consecutiveFailures: 0 },
      ],
    };

    const applied = monitor.applyRotationPolicy(policy, snapshot);

    expect(applied.activePromotedMethodId).toBe('m2');
    expect(applied.promotedAt).not.toBeNull();
  });

  it('should revert rotation after the cooldown expires', () => {
    const expiredDate = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
    const policy: PaymentMethodRotationPolicy = {
      chainId: 'chain1',
      failureThreshold: 2,
      cooldownMs: 60_000,
      enabled: true,
      activePromotedMethodId: 'm2',
      promotedAt: expiredDate,
    };

    const snapshot: FallbackChainHealthSnapshot = {
      chainId: 'chain1',
      checkedAt: new Date().toISOString(),
      overallStatus: 'green',
      methods: [
        { methodId: 'm1', successRate: 1, avgLatencyMs: 0, healthy: true, lastSuccessAt: new Date().toISOString(), consecutiveFailures: 0 },
        { methodId: 'm2', successRate: 1, avgLatencyMs: 0, healthy: true, lastSuccessAt: new Date().toISOString(), consecutiveFailures: 0 },
      ],
    };

    const applied = monitor.applyRotationPolicy(policy, snapshot);

    expect(applied.activePromotedMethodId).toBeNull();
    expect(applied.promotedAt).toBeNull();
  });

  it('should not rotate when the policy is disabled', () => {
    const policy: PaymentMethodRotationPolicy = {
      chainId: 'chain1',
      failureThreshold: 1,
      cooldownMs: 60_000,
      enabled: false,
      activePromotedMethodId: null,
      promotedAt: null,
    };

    const snapshot: FallbackChainHealthSnapshot = {
      chainId: 'chain1',
      checkedAt: new Date().toISOString(),
      overallStatus: 'red',
      methods: [
        { methodId: 'm1', successRate: 0, avgLatencyMs: 0, healthy: false, lastSuccessAt: null, consecutiveFailures: 5 },
        { methodId: 'm2', successRate: 1, avgLatencyMs: 0, healthy: true, lastSuccessAt: new Date().toISOString(), consecutiveFailures: 0 },
      ],
    };

    const applied = monitor.applyRotationPolicy(policy, snapshot);
    expect(applied.activePromotedMethodId).toBeNull();
  });
});

// ── SmartFallbackSelector ─────────────────────────────────────────────────

describe('SmartFallbackSelector', () => {
  let selector: SmartFallbackSelector;

  beforeEach(() => {
    selector = SmartFallbackSelector.getInstance();
  });

  it('should keep original order when all methods are healthy', () => {
    const snapshot: FallbackChainHealthSnapshot = {
      chainId: 'c1',
      checkedAt: new Date().toISOString(),
      overallStatus: 'green',
      methods: [
        { methodId: 'm1', successRate: 1, avgLatencyMs: 0, healthy: true, lastSuccessAt: null, consecutiveFailures: 0 },
        { methodId: 'm2', successRate: 1, avgLatencyMs: 0, healthy: true, lastSuccessAt: null, consecutiveFailures: 0 },
      ],
    };

    const result = selector.selectFallbackOrder(['m1', 'm2'], snapshot, null);

    expect(result.fallbackOrder).toEqual(['m1', 'm2']);
    expect(result.selectedMethodId).toBe('m1');
  });

  it('should sink unhealthy methods to the back', () => {
    const snapshot: FallbackChainHealthSnapshot = {
      chainId: 'c1',
      checkedAt: new Date().toISOString(),
      overallStatus: 'yellow',
      methods: [
        { methodId: 'm1', successRate: 0, avgLatencyMs: 0, healthy: false, lastSuccessAt: null, consecutiveFailures: 5 },
        { methodId: 'm2', successRate: 1, avgLatencyMs: 0, healthy: true, lastSuccessAt: null, consecutiveFailures: 0 },
      ],
    };

    const result = selector.selectFallbackOrder(['m1', 'm2'], snapshot, null);

    expect(result.fallbackOrder[0]).toBe('m2');
    expect(result.fallbackOrder[1]).toBe('m1');
    expect(result.selectedMethodId).toBe('m2');
  });

  it('should honour the active rotation promotion', () => {
    const snapshot: FallbackChainHealthSnapshot = {
      chainId: 'c1',
      checkedAt: new Date().toISOString(),
      overallStatus: 'green',
      methods: [
        { methodId: 'm1', successRate: 0.8, avgLatencyMs: 0, healthy: true, lastSuccessAt: null, consecutiveFailures: 0 },
        { methodId: 'm2', successRate: 0.9, avgLatencyMs: 0, healthy: true, lastSuccessAt: null, consecutiveFailures: 0 },
      ],
    };

    const policy: PaymentMethodRotationPolicy = {
      chainId: 'c1',
      failureThreshold: 2,
      cooldownMs: 60_000,
      enabled: true,
      activePromotedMethodId: 'm2',
      promotedAt: new Date().toISOString(),
    };

    const result = selector.selectFallbackOrder(['m1', 'm2'], snapshot, policy);

    expect(result.selectedMethodId).toBe('m2');
    expect(result.reasoning).toContain('rotation policy active');
  });
});

// ── Diagnostic report ─────────────────────────────────────────────────────

describe('buildFallbackChainDiagnosticReport', () => {
  it('should produce a non-empty report string', () => {
    const snapshot: FallbackChainHealthSnapshot = {
      chainId: 'c1',
      checkedAt: new Date().toISOString(),
      overallStatus: 'green',
      methods: [
        { methodId: 'm1', successRate: 1, avgLatencyMs: 120, healthy: true, lastSuccessAt: new Date().toISOString(), consecutiveFailures: 0 },
      ],
    };
    const selection = {
      selectedMethodId: 'm1',
      reasoning: 'highest health score',
      fallbackOrder: ['m1'],
      estimatedSuccessRate: 1,
    };

    const report = buildFallbackChainDiagnosticReport(snapshot, selection);

    expect(report).toContain('c1');
    expect(report).toContain('GREEN');
    expect(report).toContain('m1');
    expect(report).toContain('100%');
  });
});
