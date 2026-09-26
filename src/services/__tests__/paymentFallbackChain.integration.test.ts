/**
 * Integration tests — fallback chain critical paths
 *
 * Tests here exercise PaymentMethodService + FallbackChainEngine end-to-end,
 * with only the network layer (ethers providers) mocked. No store, no React.
 *
 * Critical paths covered:
 *   1. Sequential fallback — first method fails, second succeeds
 *   2. Full chain failure — every method exhausted
 *   3. stopOnHardDecline — chain halts on an expired method
 *   4. maxAttempts cap — only N entries tried even if more exist
 *   5. Gas price spike blocks entire chain
 *   6. Strategy engine — sticky strategy prefers last-success method
 *   7. Strategy engine — geo-aware prefers matching chainId
 *   8. PaymentMethodManager — circuit breaker opens after threshold
 *   9. Default chain is used when no explicit chain configured
 */

import { PaymentMethodService, PaymentMethodErrorCode } from '../../services/paymentMethodService';
import { FallbackChainEngine } from '../../services/FallbackChainEngine';
import { PaymentMethodManager } from '../../services/PaymentMethodManager';
import {
  PaymentMethod,
  PaymentPriority,
  TokenType,
  FallbackChain,
  PaymentAttempt,
} from '../../types/wallet';

// ── Mock ethers ────────────────────────────────────────────────────────────

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers') as Record<string, unknown>;
  return {
    ...actual,
    providers: {
      JsonRpcProvider: jest.fn().mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue({ gte: jest.fn().mockReturnValue(true) }),
        getGasPrice: jest.fn().mockResolvedValue({ toString: () => '20000000000' }),
        getCode: jest.fn().mockResolvedValue('0x1234'),
      })),
    },
    utils: {
      ...(actual.utils as Record<string, unknown>),
      isAddress: jest.fn().mockReturnValue(true),
      formatUnits: jest.fn().mockImplementation((_v: unknown, unit: string) =>
        unit === 'gwei' ? '20.0' : '1.0'
      ),
      parseUnits: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue(true),
      }),
      keccak256: jest.fn().mockReturnValue('0xhash'),
    },
    BigNumber: {
      from: jest.fn().mockImplementation(() => ({
        gt: jest.fn().mockReturnValue(false),
        lte: jest.fn().mockReturnValue(true),
        gte: jest.fn().mockReturnValue(true),
      })),
    },
    Contract: jest.fn().mockImplementation(() => ({
      decimals: jest.fn().mockResolvedValue(18),
      symbol: jest.fn().mockResolvedValue('ETH'),
      balanceOf: jest.fn().mockResolvedValue({ gte: jest.fn().mockReturnValue(true) }),
    })),
  };
});

jest.mock('../../config/evm', () => ({
  getEvmRpcUrl: jest.fn().mockReturnValue('https://rpc.example.com'),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-01-01T00:00:00Z');

function makeMethod(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: `pm_${Math.random().toString(36).slice(2, 9)}`,
    userId: '0xOwner',
    tokenType: TokenType.NATIVE,
    tokenAddress: '0x0000000000000000000000000000000000000000',
    chainId: 1,
    label: 'Method',
    priority: PaymentPriority.PRIMARY,
    maxSpendPerInterval: '10000',
    isVerified: true,
    isActive: true,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    metadata: {},
    ...overrides,
  };
}

function makeChain(
  methodIds: string[],
  overrides: Partial<FallbackChain> = {}
): FallbackChain {
  return {
    id: `chain_${Math.random().toString(36).slice(2, 9)}`,
    name: 'Test chain',
    methodIds,
    subscriptionId: null,
    maxAttempts: 0,
    stopOnHardDecline: false,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function freshService(): PaymentMethodService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (PaymentMethodService as any).instance = undefined;
  const svc = PaymentMethodService.getInstance();
  svc.setWalletManager({
    getConnection: () => ({ address: '0xOwner', chainId: 1, isConnected: true }),
  });
  return svc;
}

// ── 1. Sequential fallback ─────────────────────────────────────────────────

describe('Integration: sequential fallback', () => {
  it('succeeds on the second method when the first has insufficient balance', async () => {
    const svc = freshService();
    const m1 = makeMethod({ id: 'pm_m1', label: 'Primary (empty)' });
    const m2 = makeMethod({ id: 'pm_m2', label: 'Backup (funded)', priority: PaymentPriority.BACKUP });
    const chain = makeChain([m1.id, m2.id]);

    jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: true, currentGasPrice: '20' });
    jest.spyOn(svc, 'checkBalance')
      .mockResolvedValueOnce({ sufficient: false, balance: '0', symbol: 'ETH' })
      .mockResolvedValueOnce({ sufficient: true,  balance: '500', symbol: 'ETH' });

    const result = await svc.processPaymentWithChain(chain, [m1, m2], 'sub_1', '10', 1);

    expect(result.success).toBe(true);
    expect(result.attempt?.paymentMethodId).toBe('pm_m2');
    expect(result.succeededAtPosition).toBe(1);
    expect(result.fallbackAttempts).toHaveLength(1);
    expect(result.fallbackAttempts[0].paymentMethodId).toBe('pm_m1');
    expect(result.fallbackAttempts[0].status).toBe('failed');
  });
});

// ── 2. Full chain failure ──────────────────────────────────────────────────

describe('Integration: full chain failure', () => {
  it('returns success=false with all attempts when every method fails', async () => {
    const svc = freshService();
    const methods = [
      makeMethod({ id: 'pm_f1' }),
      makeMethod({ id: 'pm_f2', priority: PaymentPriority.BACKUP }),
      makeMethod({ id: 'pm_f3', priority: PaymentPriority.FALLBACK }),
    ];
    const chain = makeChain(methods.map((m) => m.id));

    jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: true, currentGasPrice: '20' });
    jest.spyOn(svc, 'checkBalance').mockResolvedValue({ sufficient: false, balance: '0', symbol: 'ETH' });

    const result = await svc.processPaymentWithChain(chain, methods, 'sub_2', '10', 1);

    expect(result.success).toBe(false);
    expect(result.attempt).toBeNull();
    expect(result.succeededAtPosition).toBe(-1);
    expect(result.fallbackAttempts).toHaveLength(3);
    expect(result.fallbackAttempts.every((a) => a.status === 'failed')).toBe(true);
  });
});

// ── 3. stopOnHardDecline ───────────────────────────────────────────────────

describe('Integration: stopOnHardDecline', () => {
  it('halts the chain immediately when the first method is expired', async () => {
    const svc = freshService();
    const expired = makeMethod({ id: 'pm_exp', expiresAt: new Date(0) });
    const backup  = makeMethod({ id: 'pm_bk',  priority: PaymentPriority.BACKUP });
    const chain   = makeChain([expired.id, backup.id], { stopOnHardDecline: true });

    // Inject expired into resolved list so the expiry check is reached
    jest.spyOn(svc, 'resolveChainMethods').mockReturnValue([expired, backup]);
    jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: true, currentGasPrice: '20' });

    const result = await svc.processPaymentWithChain(chain, [expired, backup], 'sub_3', '10', 1);

    expect(result.haltedOnHardDecline).toBe(true);
    expect(result.success).toBe(false);
    // Only the expired method was attempted before halting
    expect(result.fallbackAttempts).toHaveLength(1);
    expect(result.fallbackAttempts[0].paymentMethodId).toBe('pm_exp');
  });
});

// ── 4. maxAttempts cap ─────────────────────────────────────────────────────

describe('Integration: maxAttempts cap', () => {
  it('tries at most maxAttempts methods even if more exist', async () => {
    const svc = freshService();
    const methods = Array.from({ length: 5 }, (_, i) =>
      makeMethod({ id: `pm_cap_${i}`, priority: PaymentPriority.PRIMARY })
    );
    const chain = makeChain(methods.map((m) => m.id), { maxAttempts: 2 });

    jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: true, currentGasPrice: '20' });
    jest.spyOn(svc, 'checkBalance').mockResolvedValue({ sufficient: false, balance: '0', symbol: 'ETH' });

    const result = await svc.processPaymentWithChain(chain, methods, 'sub_4', '10', 1);

    expect(result.success).toBe(false);
    // Only 2 methods should have been tried
    expect(result.fallbackAttempts).toHaveLength(2);
  });
});

// ── 5. Gas price spike ─────────────────────────────────────────────────────

describe('Integration: gas price spike', () => {
  it('rejects every method and reports gas reason in each attempt', async () => {
    const svc = freshService();
    const m1 = makeMethod({ id: 'pm_gas1' });
    const m2 = makeMethod({ id: 'pm_gas2', priority: PaymentPriority.BACKUP });
    const chain = makeChain([m1.id, m2.id]);

    jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: false, currentGasPrice: '999' });

    const result = await svc.processPaymentWithChain(chain, [m1, m2], 'sub_5', '10', 1);

    expect(result.success).toBe(false);
    result.fallbackAttempts.forEach((a) => {
      expect(a.failureReason).toMatch(/Gas price/i);
    });
  });
});

// ── 6. Sticky strategy ─────────────────────────────────────────────────────

describe('Integration: sticky strategy', () => {
  it('places last-successful method first for the same subscription', async () => {
    const svc = freshService();
    const engine = new FallbackChainEngine(svc);

    const m1 = makeMethod({ id: 'pm_s1', label: 'Method 1' });
    const m2 = makeMethod({ id: 'pm_s2', label: 'Method 2', priority: PaymentPriority.BACKUP });

    const priorAttempts: PaymentAttempt[] = [
      {
        id: 'att_prev',
        paymentMethodId: m2.id,
        subscriptionId: 'sub_sticky',
        amount: '10',
        tokenType: TokenType.NATIVE,
        status: 'success',
        attemptedAt: new Date('2025-12-01'),
        resolvedAt: new Date('2025-12-01'),
      },
    ];

    const preview = engine.preview('sticky', [m1, m2], priorAttempts, {
      subscriptionId: 'sub_sticky',
      amount: '10',
      chainId: 1,
      maxGasPriceGwei: 500,
    });

    // m2 was the last success for this subscription — it should be first
    expect(preview.orderedMethods[0].id).toBe(m2.id);
    expect(preview.strategyId).toBe('sticky');
  });
});

// ── 7. Geo-aware strategy ──────────────────────────────────────────────────

describe('Integration: geo-aware strategy', () => {
  it('puts same-chain methods before cross-chain methods', () => {
    const svc = freshService();
    const engine = new FallbackChainEngine(svc);

    const onChain  = makeMethod({ id: 'pm_on',  chainId: 137 });
    const offChain = makeMethod({ id: 'pm_off', chainId: 1 });

    const preview = engine.preview('geo-aware', [onChain, offChain], [], {
      subscriptionId: 'sub_geo',
      amount: '10',
      chainId: 137,
      maxGasPriceGwei: 500,
    });

    expect(preview.orderedMethods[0].id).toBe('pm_on');
    expect(preview.orderedMethods[1].id).toBe('pm_off');
  });
});

// ── 8. Circuit breaker ─────────────────────────────────────────────────────

describe('Integration: circuit breaker', () => {
  it('opens circuit after CIRCUIT_OPEN_THRESHOLD consecutive failures', async () => {
    // Reset manager singleton for a clean state
    PaymentMethodManager.resetInstance();
    const svc = freshService();
    const manager = new PaymentMethodManager(svc);

    const m = makeMethod({ id: 'pm_cb' });

    jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: true, currentGasPrice: '20' });
    jest.spyOn(svc, 'checkBalance').mockResolvedValue({ sufficient: false, balance: '0', symbol: 'ETH' });

    // Run 3 consecutive failing charges (threshold is 3)
    for (let i = 0; i < 3; i++) {
      try {
        await manager.charge([m], [], 'sub_cb', '10', 1);
      } catch {
        // expected failures — ignore
      }
    }

    expect(manager.getCircuitState(m.id)).toBe('open');
    expect(manager.isBlocked(m.id)).toBe(true);
  });

  it('resets circuit after manual reset', async () => {
    PaymentMethodManager.resetInstance();
    const svc = freshService();
    const manager = new PaymentMethodManager(svc);

    const m = makeMethod({ id: 'pm_reset' });
    manager.tripCircuit(m.id);
    expect(manager.getCircuitState(m.id)).toBe('open');

    manager.resetCircuit(m.id);
    expect(manager.getCircuitState(m.id)).toBe('closed');
    expect(manager.isBlocked(m.id)).toBe(false);
  });
});

// ── 9. Default chain ───────────────────────────────────────────────────────

describe('Integration: default chain generation', () => {
  it('builds a default chain from active verified methods', () => {
    const svc = freshService();
    const methods = [
      makeMethod({ priority: PaymentPriority.PRIMARY }),
      makeMethod({ priority: PaymentPriority.BACKUP }),
      makeMethod({ priority: PaymentPriority.FALLBACK }),
    ];

    const chain = svc.buildDefaultChain(methods);

    expect(chain.subscriptionId).toBeNull();
    expect(chain.methodIds.length).toBeGreaterThan(0);
    expect(chain.methodIds.length).toBeLessThanOrEqual(5); // MAX_CHAIN_LENGTH
  });

  it('stores null subscriptionId so the chain applies globally', () => {
    const svc = freshService();
    const chain = svc.buildDefaultChain([makeMethod()]);
    expect(chain.subscriptionId).toBeNull();
  });
});

// ── 10. Round-trip: validate → process ────────────────────────────────────

describe('Integration: validate then process', () => {
  it('processes successfully after validation passes', async () => {
    const svc = freshService();
    const m1 = makeMethod({ id: 'pm_vp1' });
    const m2 = makeMethod({ id: 'pm_vp2', priority: PaymentPriority.BACKUP });
    const chain = makeChain([m1.id, m2.id]);

    const validation = svc.validateChain(chain, [m1, m2]);
    expect(validation.isValid).toBe(true);

    jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: true, currentGasPrice: '20' });
    jest.spyOn(svc, 'checkBalance').mockResolvedValue({ sufficient: true, balance: '1000', symbol: 'ETH' });

    const result = await svc.processPaymentWithChain(chain, [m1, m2], 'sub_rt', '5', 1);
    expect(result.success).toBe(true);
  });
});

// ── 11. Analytics after a mixed run ───────────────────────────────────────

describe('Integration: analytics after mixed attempts', () => {
  it('correctly computes success rate and identifies fallback usage', () => {
    const svc = freshService();
    const m1 = makeMethod({ id: 'pm_a1', label: 'Primary' });
    const m2 = makeMethod({ id: 'pm_a2', label: 'Backup', priority: PaymentPriority.BACKUP });

    const attempts: PaymentAttempt[] = [
      // Sub 1: m1 failed, m2 succeeded (fallback)
      {
        id: 'att_1a', paymentMethodId: m1.id, subscriptionId: 'sub_a1',
        amount: '10', tokenType: TokenType.NATIVE, status: 'failed',
        failureReason: 'Insufficient balance',
        attemptedAt: new Date('2026-01-01T01:00:00Z'), resolvedAt: new Date(),
      },
      {
        id: 'att_1b', paymentMethodId: m2.id, subscriptionId: 'sub_a1',
        amount: '10', tokenType: TokenType.NATIVE, status: 'success',
        attemptedAt: new Date('2026-01-01T01:00:01Z'), resolvedAt: new Date(),
      },
      // Sub 2: m1 succeeded directly
      {
        id: 'att_2a', paymentMethodId: m1.id, subscriptionId: 'sub_a2',
        amount: '10', tokenType: TokenType.NATIVE, status: 'success',
        attemptedAt: new Date('2026-01-01T02:00:00Z'), resolvedAt: new Date(),
      },
    ];

    const analytics = svc.computeAnalytics([m1, m2], attempts);

    expect(analytics.totalAttempts).toBe(3);
    expect(analytics.totalSuccesses).toBe(2);
    expect(analytics.totalFailures).toBe(1);
    expect(analytics.successRate).toBeCloseTo(2 / 3, 2);
    // 1 out of 2 successes used a fallback
    expect(analytics.fallbackRate).toBe(0.5);
    expect(analytics.mostReliableMethodId).toBe(m2.id); // 100% success rate
    expect(analytics.failureReasons[0].reason).toMatch(/Insufficient balance/);
  });
});
