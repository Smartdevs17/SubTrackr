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
  usePaymentStore.setState({ methods: [], attemptLog: [] });
  return usePaymentStore.getState();
};

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
