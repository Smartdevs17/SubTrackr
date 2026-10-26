import { usePaymentStore } from '../paymentStore';

const makeMethodInput = (overrides = {}) => ({
  label: 'Test USDC',
  tokenType: 'USDC',
  tokenAddress: '0xabc',
  chainId: 1,
  priority: 'primary' as const,
  maxSpendPerInterval: 1000,
  autoRechargeThreshold: 50,
  autoRechargeAmount: 200,
  expiresAt: null,
  ...overrides,
});

const freshStore = () => {
  usePaymentStore.setState({ methods: [], attemptLog: [], chains: [] });
  return usePaymentStore.getState();
};

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number): number => Date.now() + days * DAY_MS;

describe('addMethod', () => {
  it('creates a method with correct defaults', () => {
    const store = freshStore();
    const method = store.addMethod(makeMethodInput());
    expect(method.isVerified).toBe(false);
    expect(method.isActive).toBe(true);
    expect(method.lastUsedAt).toBeNull();
    expect(usePaymentStore.getState().methods).toHaveLength(1);
  });

  it('throws when exceeding 10 methods', () => {
    const store = freshStore();
    for (let i = 0; i < 10; i++) {
      store.addMethod(makeMethodInput({ label: `Method ${i}` }));
    }
    expect(() => store.addMethod(makeMethodInput({ label: 'Overflow' }))).toThrow();
  });
});

describe('verifyMethod', () => {
  it('sets isVerified to true', () => {
    const store = freshStore();
    const method = store.addMethod(makeMethodInput());
    usePaymentStore.getState().verifyMethod(method.id);
    const updated = usePaymentStore.getState().methods.find((m) => m.id === method.id);
    expect(updated?.isVerified).toBe(true);
  });
});

describe('setPriority', () => {
  it('updates priority', () => {
    const store = freshStore();
    const method = store.addMethod(makeMethodInput({ priority: 'primary' }));
    usePaymentStore.getState().setPriority(method.id, 'backup');
    const updated = usePaymentStore.getState().methods.find((m) => m.id === method.id);
    expect(updated?.priority).toBe('backup');
  });
});

describe('deactivateExpired', () => {
  it('deactivates methods past expiresAt', () => {
    const store = freshStore();
    const expired = store.addMethod(makeMethodInput({ expiresAt: Date.now() - 1000 }));
    const count = usePaymentStore.getState().deactivateExpired();
    expect(count).toBe(1);
    const updated = usePaymentStore.getState().methods.find((m) => m.id === expired.id);
    expect(updated?.isActive).toBe(false);
  });

  it('does not deactivate non-expired methods', () => {
    const store = freshStore();
    store.addMethod(makeMethodInput({ expiresAt: Date.now() + 1000 * 60 * 60 }));
    const count = usePaymentStore.getState().deactivateExpired();
    expect(count).toBe(0);
  });
});

describe('getExpiringMethods', () => {
  it('returns methods expiring within withinDays', () => {
    const store = freshStore();
    const soon = Date.now() + 5 * 24 * 60 * 60 * 1000;
    store.addMethod(makeMethodInput({ expiresAt: soon }));
    store.addMethod(makeMethodInput({ label: 'No expiry', expiresAt: null }));
    const expiring = usePaymentStore.getState().getExpiringMethods(10);
    expect(expiring).toHaveLength(1);
  });

  it('does not return already expired methods', () => {
    const store = freshStore();
    store.addMethod(makeMethodInput({ expiresAt: Date.now() - 1000 }));
    const expiring = usePaymentStore.getState().getExpiringMethods(30);
    expect(expiring).toHaveLength(0);
  });
});

describe('chargeWithFallback', () => {
  it('returns success for a valid primary method', () => {
    const store = freshStore();
    store.addMethod(makeMethodInput({ priority: 'primary', maxSpendPerInterval: 1000 }));
    const result = usePaymentStore.getState().chargeWithFallback(100);
    expect(result?.success).toBe(true);
  });

  it('skips expired methods and falls through to backup', () => {
    const store = freshStore();
    store.addMethod(makeMethodInput({ priority: 'primary', expiresAt: Date.now() - 1000 }));
    store.addMethod(makeMethodInput({ priority: 'backup', label: 'Backup', expiresAt: null }));
    usePaymentStore.getState().deactivateExpired();
    const result = usePaymentStore.getState().chargeWithFallback(50);
    expect(result?.success).toBe(true);
  });

  it('skips methods where amount > maxSpendPerInterval', () => {
    const store = freshStore();
    store.addMethod(makeMethodInput({ priority: 'primary', maxSpendPerInterval: 10 }));
    store.addMethod(
      makeMethodInput({ priority: 'backup', label: 'Backup', maxSpendPerInterval: 500 })
    );
    const result = usePaymentStore.getState().chargeWithFallback(100);
    expect(result?.success).toBe(true);
  });

  it('returns null when all methods are inactive', () => {
    const store = freshStore();
    store.addMethod(makeMethodInput({ expiresAt: Date.now() - 1000 }));
    usePaymentStore.getState().deactivateExpired();
    const result = usePaymentStore.getState().chargeWithFallback(50);
    expect(result).toBeNull();
  });

  it('records attempt in log', () => {
    const store = freshStore();
    store.addMethod(makeMethodInput({ priority: 'primary' }));
    usePaymentStore.getState().chargeWithFallback(10);
    expect(usePaymentStore.getState().attemptLog.length).toBeGreaterThan(0);
  });
});

describe('fallback chains', () => {
  it('creates a chain over existing methods', () => {
    const store = freshStore();
    const first = store.addMethod(makeMethodInput({ label: 'First' }));
    const second = store.addMethod(makeMethodInput({ label: 'Second' }));

    const chain = usePaymentStore.getState().createChain('Main', [first.id, second.id]);
    expect(chain.methodIds).toEqual([first.id, second.id]);
    expect(chain.isActive).toBe(true);
    expect(usePaymentStore.getState().chains).toHaveLength(1);
  });

  it('rejects an empty, duplicated or unknown chain', () => {
    const store = freshStore();
    const method = store.addMethod(makeMethodInput());

    expect(() => usePaymentStore.getState().createChain('Empty', [])).toThrow(/at least one/);
    expect(() =>
      usePaymentStore.getState().createChain('Dupe', [method.id, method.id])
    ).toThrow(/appears twice/);
    expect(() => usePaymentStore.getState().createChain('Missing', ['nope'])).toThrow(
      /does not exist/
    );
  });

  it('warns about a single-method chain', () => {
    const store = freshStore();
    const method = store.addMethod(makeMethodInput());
    const chain = usePaymentStore.getState().createChain('Solo', [method.id]);

    expect(usePaymentStore.getState().validateChain(chain).warnings).toContain(
      'A single-method chain has no fallback if that method fails.'
    );
  });

  it('excludes expired methods when resolving a chain', () => {
    const store = freshStore();
    const live = store.addMethod(makeMethodInput({ label: 'Live' }));
    const expired = store.addMethod(makeMethodInput({ label: 'Expired', expiresAt: inDays(-1) }));
    const chain = usePaymentStore.getState().createChain('Mixed', [live.id, expired.id]);

    expect(usePaymentStore.getState().resolveChainMethods(chain).map((m) => m.id)).toEqual([
      live.id,
    ]);
  });

  it('caps a chain at maxAttempts', () => {
    const store = freshStore();
    const first = store.addMethod(makeMethodInput({ label: 'First' }));
    const second = store.addMethod(makeMethodInput({ label: 'Second' }));
    const chain = usePaymentStore
      .getState()
      .createChain('Capped', [first.id, second.id], { maxAttempts: 1 });

    expect(usePaymentStore.getState().resolveChainMethods(chain)).toHaveLength(1);
  });

  it('reorders a chain', () => {
    const store = freshStore();
    const first = store.addMethod(makeMethodInput({ label: 'First' }));
    const second = store.addMethod(makeMethodInput({ label: 'Second' }));
    const chain = usePaymentStore.getState().createChain('Main', [first.id, second.id]);

    usePaymentStore.getState().reorderChain(chain.id, [second.id, first.id]);
    expect(usePaymentStore.getState().chains[0].methodIds).toEqual([second.id, first.id]);
  });

  it('prefers a subscription chain over the global one', () => {
    const store = freshStore();
    const method = store.addMethod(makeMethodInput());
    const global = usePaymentStore.getState().createChain('Global', [method.id]);
    const scoped = usePaymentStore
      .getState()
      .createChain('Scoped', [method.id], { subscriptionId: 'sub_1' });

    expect(usePaymentStore.getState().chainForSubscription('sub_1')?.id).toBe(scoped.id);
    expect(usePaymentStore.getState().chainForSubscription('sub_2')?.id).toBe(global.id);
  });

  it('deletes a chain', () => {
    const store = freshStore();
    const method = store.addMethod(makeMethodInput());
    const chain = usePaymentStore.getState().createChain('Main', [method.id]);

    usePaymentStore.getState().deleteChain(chain.id);
    expect(usePaymentStore.getState().chains).toHaveLength(0);
  });
});

describe('chargeWithChain', () => {
  it('succeeds on the first usable method', () => {
    const store = freshStore();
    const first = store.addMethod(makeMethodInput({ label: 'First' }));
    const second = store.addMethod(makeMethodInput({ label: 'Second' }));
    const chain = usePaymentStore.getState().createChain('Main', [first.id, second.id]);

    const result = usePaymentStore.getState().chargeWithChain(chain.id, 10);
    expect(result).toMatchObject({ methodId: first.id, success: true, chainPosition: 0 });
    expect(usePaymentStore.getState().methods[0].lastUsedAt).not.toBeNull();
  });

  it('falls through a method whose spend limit the charge exceeds', () => {
    const store = freshStore();
    const capped = store.addMethod(makeMethodInput({ label: 'Capped', maxSpendPerInterval: 5 }));
    const open = store.addMethod(makeMethodInput({ label: 'Open', maxSpendPerInterval: 0 }));
    const chain = usePaymentStore.getState().createChain('Main', [capped.id, open.id]);

    const result = usePaymentStore.getState().chargeWithChain(chain.id, 100);
    expect(result).toMatchObject({ methodId: open.id, success: true, chainPosition: 1 });
    expect(usePaymentStore.getState().attemptLog[0].failureReason).toBe('limit_exceeded');
  });

  it('halts on a hard decline when configured to', () => {
    const store = freshStore();
    const expired = store.addMethod(makeMethodInput({ label: 'Expired', expiresAt: inDays(-1) }));
    const healthy = store.addMethod(makeMethodInput({ label: 'Healthy' }));
    const chain = usePaymentStore
      .getState()
      .createChain('Strict', [expired.id, healthy.id], { stopOnHardDecline: true });

    const result = usePaymentStore.getState().chargeWithChain(chain.id, 10);
    expect(result).toMatchObject({ success: false, failureReason: 'expired' });
    expect(usePaymentStore.getState().attemptLog).toHaveLength(1);
  });

  it('falls through a hard decline by default', () => {
    const store = freshStore();
    const expired = store.addMethod(makeMethodInput({ label: 'Expired', expiresAt: inDays(-1) }));
    const healthy = store.addMethod(makeMethodInput({ label: 'Healthy' }));
    const chain = usePaymentStore.getState().createChain('Lenient', [expired.id, healthy.id]);

    const result = usePaymentStore.getState().chargeWithChain(chain.id, 10);
    expect(result).toMatchObject({ methodId: healthy.id, success: true });
  });

  it('returns null for an unknown chain', () => {
    freshStore();
    expect(usePaymentStore.getState().chargeWithChain('nope', 10)).toBeNull();
  });
});

describe('expiry alerts', () => {
  it('grades severity by how close the expiry is', () => {
    const store = freshStore();
    store.addMethod(makeMethodInput({ label: 'Expired', expiresAt: inDays(-2) }));
    store.addMethod(makeMethodInput({ label: 'Critical', expiresAt: inDays(3) }));
    store.addMethod(makeMethodInput({ label: 'Warning', expiresAt: inDays(20) }));
    store.addMethod(makeMethodInput({ label: 'Fine', expiresAt: inDays(90) }));
    store.addMethod(makeMethodInput({ label: 'Perpetual' }));

    const alerts = usePaymentStore.getState().getExpiryAlerts();
    expect(alerts.map((a) => a.severity)).toEqual(['expired', 'critical', 'warning']);
  });

  it('flags a method that is still in an active chain', () => {
    const store = freshStore();
    const chained = store.addMethod(makeMethodInput({ label: 'Chained', expiresAt: inDays(3) }));
    store.addMethod(makeMethodInput({ label: 'Loose', expiresAt: inDays(4) }));
    usePaymentStore.getState().createChain('Main', [chained.id]);

    const alerts = usePaymentStore.getState().getExpiryAlerts();
    expect(alerts[0]).toMatchObject({ methodId: chained.id, inActiveChain: true });
    expect(alerts[0].message).toMatch(/still in a fallback chain/);
    expect(alerts[1].inActiveChain).toBe(false);
  });

  it('honours a narrower window', () => {
    const store = freshStore();
    store.addMethod(makeMethodInput({ label: 'Soon', expiresAt: inDays(5) }));
    store.addMethod(makeMethodInput({ label: 'Later', expiresAt: inDays(20) }));

    expect(usePaymentStore.getState().getExpiryAlerts(7)).toHaveLength(1);
  });
});

describe('analytics', () => {
  it('reports zeroes before any charge', () => {
    const store = freshStore();
    store.addMethod(makeMethodInput());

    expect(usePaymentStore.getState().getAnalytics()).toMatchObject({
      totalAttempts: 0,
      successRate: 0,
      fallbackRate: 0,
      activeMethods: 1,
    });
  });

  it('computes success rates per method', () => {
    const store = freshStore();
    const capped = store.addMethod(makeMethodInput({ label: 'Capped', maxSpendPerInterval: 5 }));
    const open = store.addMethod(makeMethodInput({ label: 'Open', maxSpendPerInterval: 0 }));
    const chain = usePaymentStore.getState().createChain('Main', [capped.id, open.id]);

    usePaymentStore.getState().chargeWithChain(chain.id, 100);
    usePaymentStore.getState().chargeWithChain(chain.id, 100);

    const analytics = usePaymentStore.getState().getAnalytics();
    expect(analytics.totalAttempts).toBe(4);
    expect(analytics.successRate).toBe(0.5);
    expect(analytics.byMethod.find((m) => m.methodId === capped.id)?.successRate).toBe(0);
    expect(analytics.byMethod.find((m) => m.methodId === open.id)?.volume).toBe(200);
    expect(analytics.mostReliableMethodId).toBe(open.id);
  });

  it('measures how often the fallback earns its keep', () => {
    const store = freshStore();
    const capped = store.addMethod(makeMethodInput({ label: 'Capped', maxSpendPerInterval: 5 }));
    const open = store.addMethod(makeMethodInput({ label: 'Open', maxSpendPerInterval: 0 }));
    const chain = usePaymentStore.getState().createChain('Main', [capped.id, open.id]);

    // One charge lands on the head of the chain, one only on the fallback.
    usePaymentStore.getState().chargeWithChain(chain.id, 1);
    usePaymentStore.getState().chargeWithChain(chain.id, 100);

    expect(usePaymentStore.getState().getAnalytics().fallbackRate).toBe(0.5);
  });

  it('ranks failure reasons', () => {
    const store = freshStore();
    const capped = store.addMethod(makeMethodInput({ label: 'Capped', maxSpendPerInterval: 5 }));
    const chain = usePaymentStore.getState().createChain('Main', [capped.id]);

    usePaymentStore.getState().chargeWithChain(chain.id, 100);
    usePaymentStore.getState().chargeWithChain(chain.id, 100);

    const analytics = usePaymentStore.getState().getAnalytics();
    expect(analytics.failureReasons[0]).toEqual({ reason: 'limit_exceeded', count: 2 });
    expect(analytics.byMethod[0].topFailureReason).toBe('limit_exceeded');
  });
});
