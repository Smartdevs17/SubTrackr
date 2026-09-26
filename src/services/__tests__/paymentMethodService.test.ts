/**
 * Unit tests for PaymentMethodService
 *
 * Covers: validation, expiry, priority sorting, chain validation, analytics,
 * sharing, and the processPaymentWithChain fallback logic.
 *
 * All network I/O (ethers providers) is mocked so tests run without a node.
 */

import {
  PaymentMethodService,
  PaymentMethodError,
  PaymentMethodErrorCode,
  PaymentMethodExpiryCheck,
  ChainPaymentResult,
} from '../paymentMethodService';
import {
  PaymentMethod,
  PaymentPriority,
  TokenType,
  FallbackChain,
  PaymentAttempt,
  PaymentMethodShare,
} from '../../types/wallet';

// ── ethers mock ────────────────────────────────────────────────────────────

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers') as Record<string, unknown>;
  return {
    ...actual,
    providers: {
      JsonRpcProvider: jest.fn().mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue({ gte: jest.fn().mockReturnValue(true), toString: () => '1000000000000000000' }),
        getGasPrice: jest.fn().mockResolvedValue({ toString: () => '20000000000' }),
        getCode: jest.fn().mockResolvedValue('0x1234'),
      })),
    },
    utils: {
      ...(actual.utils as Record<string, unknown>),
      isAddress: jest.fn().mockReturnValue(true),
      formatUnits: jest.fn().mockReturnValue('20.0'),
      parseUnits: jest.fn().mockReturnValue({ gte: jest.fn().mockReturnValue(true) }),
      keccak256: jest.fn().mockReturnValue('0xabc'),
    },
    BigNumber: {
      from: jest.fn().mockImplementation((v) => ({
        gt: jest.fn().mockReturnValue(false),
        lte: jest.fn().mockReturnValue(true),
        gte: jest.fn().mockReturnValue(true),
        toString: () => String(v),
      })),
    },
    Contract: jest.fn().mockImplementation(() => ({
      decimals: jest.fn().mockResolvedValue(18),
      symbol: jest.fn().mockResolvedValue('ETH'),
      balanceOf: jest.fn().mockResolvedValue({ gte: jest.fn().mockReturnValue(true), toString: () => '1000000000000000000' }),
    })),
  };
});

jest.mock('../../config/evm', () => ({
  getEvmRpcUrl: jest.fn().mockReturnValue('https://rpc.example.com'),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────

const NOW = new Date('2026-01-01T00:00:00Z');

function makeMethod(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: `pm_${Math.random().toString(36).slice(2, 8)}`,
    userId: '0xUser',
    tokenType: TokenType.NATIVE,
    tokenAddress: '0x0000000000000000000000000000000000000000',
    chainId: 1,
    label: 'Test method',
    priority: PaymentPriority.PRIMARY,
    maxSpendPerInterval: '1000',
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

function makeChain(overrides: Partial<FallbackChain> = {}): FallbackChain {
  return {
    id: `chain_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test chain',
    methodIds: [],
    subscriptionId: null,
    maxAttempts: 0,
    stopOnHardDecline: false,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  return {
    id: `att_${Math.random().toString(36).slice(2, 8)}`,
    paymentMethodId: 'pm_test',
    subscriptionId: 'sub_test',
    amount: '10',
    tokenType: TokenType.NATIVE,
    status: 'success',
    attemptedAt: NOW,
    resolvedAt: NOW,
    ...overrides,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function freshService(): PaymentMethodService {
  // Reset singleton to get a clean instance for each test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (PaymentMethodService as any).instance = undefined;
  const svc = PaymentMethodService.getInstance();
  svc.setWalletManager({
    getConnection: () => ({
      address: '0xUser',
      chainId: 1,
      isConnected: true,
    }),
  });
  return svc;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PaymentMethodService', () => {
  // ── singleton ────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    it('returns the same instance twice', () => {
      const a = PaymentMethodService.getInstance();
      const b = PaymentMethodService.getInstance();
      expect(a).toBe(b);
    });
  });

  // ── generateId ────────────────────────────────────────────────────────────

  describe('generateId', () => {
    it('generates unique ids with pm_ prefix', () => {
      const svc = freshService();
      const a = svc.generateId();
      const b = svc.generateId();
      expect(a).toMatch(/^pm_/);
      expect(b).toMatch(/^pm_/);
      expect(a).not.toBe(b);
    });
  });

  // ── validatePaymentMethodForm ─────────────────────────────────────────────

  describe('validatePaymentMethodForm', () => {
    let svc: PaymentMethodService;
    beforeEach(() => { svc = freshService(); });

    const validInput = {
      tokenType: TokenType.NATIVE,
      tokenAddress: '0x0000000000000000000000000000000000000000',
      chainId: 1,
      label: 'My wallet',
      priority: PaymentPriority.PRIMARY,
      maxSpendPerInterval: '100',
    };

    it('passes valid input', () => {
      const result = svc.validatePaymentMethodForm(validInput);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects empty label', () => {
      const result = svc.validatePaymentMethodForm({ ...validInput, label: '' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Label is required');
    });

    it('rejects non-positive maxSpendPerInterval', () => {
      const result = svc.validatePaymentMethodForm({ ...validInput, maxSpendPerInterval: '-5' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Max spend per interval must be a positive number');
    });

    it('rejects unsupported chain ID', () => {
      const result = svc.validatePaymentMethodForm({ ...validInput, chainId: 999_999 });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Unsupported chain ID'))).toBe(true);
    });

    it('requiresVerification false for NATIVE tokens', () => {
      const result = svc.validatePaymentMethodForm(validInput);
      expect(result.requiresVerification).toBe(false);
    });

    it('requiresVerification true for ERC20 tokens', () => {
      const result = svc.validatePaymentMethodForm({ ...validInput, tokenType: TokenType.USDC });
      expect(result.requiresVerification).toBe(true);
    });

    it('warns when maxSpendPerInterval is very high', () => {
      const result = svc.validatePaymentMethodForm({ ...validInput, maxSpendPerInterval: '2e15' });
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // ── canAddMethod ──────────────────────────────────────────────────────────

  describe('canAddMethod', () => {
    it('allows adding when under limit', () => {
      const svc = freshService();
      expect(svc.canAddMethod(5).canAdd).toBe(true);
    });

    it('rejects when at limit (10)', () => {
      const svc = freshService();
      const result = svc.canAddMethod(10);
      expect(result.canAdd).toBe(false);
      expect(result.reason).toMatch(/Maximum/);
    });
  });

  // ── isDuplicateMethod ─────────────────────────────────────────────────────

  describe('isDuplicateMethod', () => {
    it('detects duplicates by tokenAddress + chainId + tokenType', () => {
      const svc = freshService();
      const existing = [makeMethod({ tokenAddress: '0xABCD', chainId: 1, tokenType: TokenType.USDC })];
      expect(svc.isDuplicateMethod(existing, '0xabcd', 1, TokenType.USDC)).toBe(true);
    });

    it('returns false for different chain', () => {
      const svc = freshService();
      const existing = [makeMethod({ tokenAddress: '0xABCD', chainId: 1, tokenType: TokenType.USDC })];
      expect(svc.isDuplicateMethod(existing, '0xABCD', 137, TokenType.USDC)).toBe(false);
    });
  });

  // ── sortByPriority ────────────────────────────────────────────────────────

  describe('sortByPriority', () => {
    it('places PRIMARY before BACKUP before FALLBACK', () => {
      const svc = freshService();
      const methods = [
        makeMethod({ priority: PaymentPriority.FALLBACK }),
        makeMethod({ priority: PaymentPriority.PRIMARY }),
        makeMethod({ priority: PaymentPriority.BACKUP }),
      ];
      const sorted = svc.sortByPriority(methods);
      expect(sorted[0].priority).toBe(PaymentPriority.PRIMARY);
      expect(sorted[1].priority).toBe(PaymentPriority.BACKUP);
      expect(sorted[2].priority).toBe(PaymentPriority.FALLBACK);
    });

    it('within same priority, prefers more recently used', () => {
      const svc = freshService();
      const older = makeMethod({ priority: PaymentPriority.PRIMARY, lastUsedAt: new Date('2025-01-01') });
      const newer = makeMethod({ priority: PaymentPriority.PRIMARY, lastUsedAt: new Date('2026-01-01') });
      const sorted = svc.sortByPriority([older, newer]);
      expect(sorted[0]).toBe(newer);
    });
  });

  // ── getActiveVerifiedMethods ───────────────────────────────────────────────

  describe('getActiveVerifiedMethods', () => {
    it('excludes inactive or unverified methods', () => {
      const svc = freshService();
      const active = makeMethod({ isActive: true, isVerified: true });
      const inactive = makeMethod({ isActive: false, isVerified: true });
      const unverified = makeMethod({ isActive: true, isVerified: false });
      const result = svc.getActiveVerifiedMethods([active, inactive, unverified]);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(active);
    });
  });

  // ── checkExpiry ───────────────────────────────────────────────────────────

  describe('checkExpiry', () => {
    it('returns no expiry when expiresAt is null', () => {
      const svc = freshService();
      const method = makeMethod({ expiresAt: null });
      const check = svc.checkExpiry(method);
      expect(check.daysUntilExpiry).toBeNull();
      expect(check.isExpired).toBe(false);
      expect(check.isExpiringSoon).toBe(false);
    });

    it('flags expired method', () => {
      const svc = freshService();
      const method = makeMethod({ expiresAt: new Date(Date.now() - 86_400_000) });
      const check = svc.checkExpiry(method);
      expect(check.isExpired).toBe(true);
    });

    it('flags expiring within 30 days', () => {
      const svc = freshService();
      const method = makeMethod({ expiresAt: new Date(Date.now() + 15 * 86_400_000) });
      const check = svc.checkExpiry(method);
      expect(check.isExpiringSoon).toBe(true);
      expect(check.isExpired).toBe(false);
    });

    it('does not flag as expiring when >30 days remain', () => {
      const svc = freshService();
      const method = makeMethod({ expiresAt: new Date(Date.now() + 60 * 86_400_000) });
      const check = svc.checkExpiry(method);
      expect(check.isExpiringSoon).toBe(false);
    });
  });

  // ── getExpiredMethods / getExpiringSoonMethods ─────────────────────────────

  describe('getExpiredMethods', () => {
    it('returns only expired methods', () => {
      const svc = freshService();
      const expired = makeMethod({ expiresAt: new Date(Date.now() - 86_400_000) });
      const valid = makeMethod({ expiresAt: null });
      expect(svc.getExpiredMethods([expired, valid])).toEqual([expired]);
    });
  });

  describe('getExpiringSoonMethods', () => {
    it('returns methods expiring within 30 days', () => {
      const svc = freshService();
      const soon = makeMethod({ expiresAt: new Date(Date.now() + 10 * 86_400_000) });
      const later = makeMethod({ expiresAt: new Date(Date.now() + 60 * 86_400_000) });
      expect(svc.getExpiringSoonMethods([soon, later])).toEqual([soon]);
    });
  });

  // ── markPaymentMethodExpired ───────────────────────────────────────────────

  describe('markPaymentMethodExpired', () => {
    it('sets isActive to false and adds metadata', () => {
      const svc = freshService();
      const method = makeMethod();
      const result = svc.markPaymentMethodExpired(method);
      expect(result.isActive).toBe(false);
      expect(result.metadata['deactivated_reason']).toBe('expired');
    });
  });

  // ── Chain validation ───────────────────────────────────────────────────────

  describe('validateChain', () => {
    it('passes a valid chain with one active verified method', () => {
      const svc = freshService();
      const m = makeMethod();
      const chain = makeChain({ methodIds: [m.id] });
      const result = svc.validateChain(chain, [m]);
      expect(result.isValid).toBe(true);
    });

    it('fails when chain has no methods', () => {
      const svc = freshService();
      const chain = makeChain({ methodIds: [] });
      const result = svc.validateChain(chain, []);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('at least one'))).toBe(true);
    });

    it('fails when a method id is duplicated', () => {
      const svc = freshService();
      const m = makeMethod();
      const chain = makeChain({ methodIds: [m.id, m.id] });
      const result = svc.validateChain(chain, [m]);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('twice'))).toBe(true);
    });

    it('fails when chain exceeds max length', () => {
      const svc = freshService();
      const methods = Array.from({ length: 6 }, () => makeMethod());
      const chain = makeChain({ methodIds: methods.map((m) => m.id) });
      const result = svc.validateChain(chain, methods);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('at most'))).toBe(true);
    });

    it('warns when chain has only one method', () => {
      const svc = freshService();
      const m = makeMethod();
      const chain = makeChain({ methodIds: [m.id] });
      const result = svc.validateChain(chain, [m]);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('fails when chain name is blank', () => {
      const svc = freshService();
      const m = makeMethod();
      const chain = makeChain({ name: '', methodIds: [m.id] });
      const result = svc.validateChain(chain, [m]);
      expect(result.isValid).toBe(false);
    });
  });

  // ── resolveChainMethods ────────────────────────────────────────────────────

  describe('resolveChainMethods', () => {
    it('excludes inactive, unverified and expired methods', () => {
      const svc = freshService();
      const active = makeMethod({ isActive: true, isVerified: true });
      const inactive = makeMethod({ isActive: false, isVerified: true });
      const expired = makeMethod({ isActive: true, isVerified: true, expiresAt: new Date(0) });
      const chain = makeChain({ methodIds: [active.id, inactive.id, expired.id] });
      const resolved = svc.resolveChainMethods(chain, [active, inactive, expired]);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBe(active);
    });

    it('respects maxAttempts cap', () => {
      const svc = freshService();
      const methods = [makeMethod(), makeMethod(), makeMethod()];
      const chain = makeChain({ methodIds: methods.map((m) => m.id), maxAttempts: 2 });
      const resolved = svc.resolveChainMethods(chain, methods);
      expect(resolved).toHaveLength(2);
    });
  });

  // ── selectChainForSubscription ─────────────────────────────────────────────

  describe('selectChainForSubscription', () => {
    it('prefers subscription-specific chain over global', () => {
      const svc = freshService();
      const global = makeChain({ subscriptionId: null });
      const specific = makeChain({ subscriptionId: 'sub_1' });
      const result = svc.selectChainForSubscription([global, specific], 'sub_1');
      expect(result).toBe(specific);
    });

    it('falls back to global chain when no specific chain exists', () => {
      const svc = freshService();
      const global = makeChain({ subscriptionId: null });
      const result = svc.selectChainForSubscription([global], 'sub_unknown');
      expect(result).toBe(global);
    });

    it('returns null when no chains are active', () => {
      const svc = freshService();
      const inactive = makeChain({ subscriptionId: null, isActive: false });
      const result = svc.selectChainForSubscription([inactive], 'sub_1');
      expect(result).toBeNull();
    });
  });

  // ── buildDefaultChain ─────────────────────────────────────────────────────

  describe('buildDefaultChain', () => {
    it('builds a chain from active verified methods up to MAX_CHAIN_LENGTH', () => {
      const svc = freshService();
      const methods = Array.from({ length: 7 }, () => makeMethod());
      const chain = svc.buildDefaultChain(methods);
      expect(chain.methodIds.length).toBeLessThanOrEqual(5);
      expect(chain.subscriptionId).toBeNull();
    });
  });

  // ── processPaymentWithChain ────────────────────────────────────────────────

  describe('processPaymentWithChain', () => {
    it('succeeds with the first eligible method', async () => {
      const svc = freshService();
      const m1 = makeMethod({ id: 'pm_a', isActive: true, isVerified: true });
      const m2 = makeMethod({ id: 'pm_b', isActive: true, isVerified: true });
      const chain = makeChain({ methodIds: [m1.id, m2.id] });

      // Mock gas and balance checks to pass
      jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: true, currentGasPrice: '20' });
      jest.spyOn(svc, 'checkBalance').mockResolvedValue({ sufficient: true, balance: '1000', symbol: 'ETH' });

      const result: ChainPaymentResult = await svc.processPaymentWithChain(
        chain,
        [m1, m2],
        'sub_1',
        '10',
        1,
      );

      expect(result.success).toBe(true);
      expect(result.attempt?.paymentMethodId).toBe('pm_a');
      expect(result.succeededAtPosition).toBe(0);
      expect(result.fallbackAttempts).toHaveLength(0);
    });

    it('falls through to second method when first fails balance check', async () => {
      const svc = freshService();
      const m1 = makeMethod({ id: 'pm_a' });
      const m2 = makeMethod({ id: 'pm_b' });
      const chain = makeChain({ methodIds: [m1.id, m2.id] });

      jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: true, currentGasPrice: '20' });
      jest
        .spyOn(svc, 'checkBalance')
        .mockResolvedValueOnce({ sufficient: false, balance: '0', symbol: 'ETH' })
        .mockResolvedValueOnce({ sufficient: true, balance: '1000', symbol: 'ETH' });

      const result = await svc.processPaymentWithChain(chain, [m1, m2], 'sub_1', '10', 1);

      expect(result.success).toBe(true);
      expect(result.attempt?.paymentMethodId).toBe('pm_b');
      expect(result.succeededAtPosition).toBe(1);
      expect(result.fallbackAttempts).toHaveLength(1);
    });

    it('returns failure when all methods fail', async () => {
      const svc = freshService();
      const m1 = makeMethod({ id: 'pm_a' });
      const chain = makeChain({ methodIds: [m1.id] });

      jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: false, currentGasPrice: '999' });

      const result = await svc.processPaymentWithChain(chain, [m1], 'sub_1', '10', 1);

      expect(result.success).toBe(false);
      expect(result.attempt).toBeNull();
      expect(result.succeededAtPosition).toBe(-1);
    });

    it('throws when chain has no usable methods', async () => {
      const svc = freshService();
      const chain = makeChain({ methodIds: [] });
      await expect(svc.processPaymentWithChain(chain, [], 'sub_1', '10', 1)).rejects.toBeInstanceOf(
        PaymentMethodError
      );
    });

    it('halts on hard decline when stopOnHardDecline is true', async () => {
      const svc = freshService();
      const expired = makeMethod({
        id: 'pm_exp',
        expiresAt: new Date(0), // already expired
      });
      const backup = makeMethod({ id: 'pm_bk' });
      const chain = makeChain({
        methodIds: [expired.id, backup.id],
        stopOnHardDecline: true,
      });

      // resolveChainMethods will exclude expired, so let's test at the higher level
      // with an expired method that passes the filter but fails the expiry check.
      // We need to circumvent resolveChainMethods by manually injecting.
      jest.spyOn(svc, 'resolveChainMethods').mockReturnValue([expired, backup]);

      jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: true, currentGasPrice: '20' });
      jest.spyOn(svc, 'checkBalance').mockResolvedValue({ sufficient: true, balance: '1000', symbol: 'ETH' });

      const result = await svc.processPaymentWithChain(chain, [expired, backup], 'sub_1', '10', 1);
      expect(result.haltedOnHardDecline).toBe(true);
      expect(result.success).toBe(false);
    });
  });

  // ── buildExpiryAlerts ─────────────────────────────────────────────────────

  describe('buildExpiryAlerts', () => {
    it('generates expired alert', () => {
      const svc = freshService();
      const method = makeMethod({ expiresAt: new Date(Date.now() - 86_400_000 * 2) });
      const alerts = svc.buildExpiryAlerts([method], []);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('expired');
    });

    it('generates critical alert within 7 days', () => {
      const svc = freshService();
      const method = makeMethod({ expiresAt: new Date(Date.now() + 3 * 86_400_000) });
      const alerts = svc.buildExpiryAlerts([method], []);
      expect(alerts[0].severity).toBe('critical');
    });

    it('flags inActiveChain when method is in an active chain', () => {
      const svc = freshService();
      const method = makeMethod({ expiresAt: new Date(Date.now() + 5 * 86_400_000) });
      const chain = makeChain({ methodIds: [method.id], isActive: true });
      const alerts = svc.buildExpiryAlerts([method], [chain]);
      expect(alerts[0].inActiveChain).toBe(true);
    });

    it('skips methods with no expiry', () => {
      const svc = freshService();
      const method = makeMethod({ expiresAt: null });
      const alerts = svc.buildExpiryAlerts([method], []);
      expect(alerts).toHaveLength(0);
    });
  });

  // ── computeAnalytics ──────────────────────────────────────────────────────

  describe('computeAnalytics', () => {
    it('returns zero metrics with no attempts', () => {
      const svc = freshService();
      const analytics = svc.computeAnalytics([], []);
      expect(analytics.totalAttempts).toBe(0);
      expect(analytics.successRate).toBe(0);
    });

    it('computes success rate correctly', () => {
      const svc = freshService();
      const m = makeMethod();
      const attempts = [
        makeAttempt({ paymentMethodId: m.id, status: 'success', subscriptionId: 'sub_1' }),
        makeAttempt({ paymentMethodId: m.id, status: 'failed', subscriptionId: 'sub_2' }),
      ];
      const analytics = svc.computeAnalytics([m], attempts);
      expect(analytics.totalSuccesses).toBe(1);
      expect(analytics.totalFailures).toBe(1);
      expect(analytics.successRate).toBe(0.5);
    });

    it('counts fallback rate when success follows failures', () => {
      const svc = freshService();
      const m1 = makeMethod({ id: 'pm_1' });
      const m2 = makeMethod({ id: 'pm_2' });
      const sub = 'sub_fb';
      const attempts = [
        makeAttempt({ paymentMethodId: m1.id, status: 'failed', subscriptionId: sub }),
        makeAttempt({ paymentMethodId: m2.id, status: 'success', subscriptionId: sub }),
      ];
      const analytics = svc.computeAnalytics([m1, m2], attempts);
      expect(analytics.fallbackRate).toBe(1); // 100% of successes were fallbacks
    });

    it('identifies most reliable method', () => {
      const svc = freshService();
      const reliable = makeMethod({ id: 'pm_reliable' });
      const unreliable = makeMethod({ id: 'pm_unreliable' });
      const attempts = [
        makeAttempt({ paymentMethodId: reliable.id, status: 'success', subscriptionId: 'sub_1' }),
        makeAttempt({ paymentMethodId: reliable.id, status: 'success', subscriptionId: 'sub_2' }),
        makeAttempt({ paymentMethodId: unreliable.id, status: 'failed', subscriptionId: 'sub_3' }),
      ];
      const analytics = svc.computeAnalytics([reliable, unreliable], attempts);
      expect(analytics.mostReliableMethodId).toBe(reliable.id);
    });
  });

  // ── Sharing ───────────────────────────────────────────────────────────────

  describe('createShare', () => {
    it('creates a valid share', () => {
      const svc = freshService();
      const method = makeMethod({ userId: '0xOwner' });
      const share = svc.createShare(method, '0xGrantee', 'viewer');
      expect(share.methodId).toBe(method.id);
      expect(share.granteeId).toBe('0xGrantee');
      expect(share.role).toBe('viewer');
      expect(share.revokedAt).toBeNull();
    });

    it('throws when grantee is blank', () => {
      const svc = freshService();
      const method = makeMethod({ userId: '0xOwner' });
      expect(() => svc.createShare(method, '', 'viewer')).toThrow(PaymentMethodError);
    });

    it('throws when sharing with own owner', () => {
      const svc = freshService();
      const method = makeMethod({ userId: '0xOwner' });
      expect(() => svc.createShare(method, '0xOwner', 'viewer')).toThrow(PaymentMethodError);
    });

    it('throws when method is inactive', () => {
      const svc = freshService();
      const method = makeMethod({ userId: '0xOwner', isActive: false });
      expect(() => svc.createShare(method, '0xGrantee', 'charger')).toThrow(PaymentMethodError);
    });
  });

  describe('isShareActive', () => {
    it('returns true for un-revoked share with no expiry', () => {
      const svc = freshService();
      const share: PaymentMethodShare = {
        id: 'sh_1',
        methodId: 'pm_1',
        granteeId: '0xG',
        role: 'viewer',
        spendLimit: null,
        expiresAt: null,
        createdAt: new Date(),
        revokedAt: null,
      };
      expect(svc.isShareActive(share)).toBe(true);
    });

    it('returns false for revoked share', () => {
      const svc = freshService();
      const share: PaymentMethodShare = {
        id: 'sh_2',
        methodId: 'pm_1',
        granteeId: '0xG',
        role: 'viewer',
        spendLimit: null,
        expiresAt: null,
        createdAt: new Date(),
        revokedAt: new Date(),
      };
      expect(svc.isShareActive(share)).toBe(false);
    });

    it('returns false for share past its expiry', () => {
      const svc = freshService();
      const share: PaymentMethodShare = {
        id: 'sh_3',
        methodId: 'pm_1',
        granteeId: '0xG',
        role: 'viewer',
        spendLimit: null,
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        revokedAt: null,
      };
      expect(svc.isShareActive(share)).toBe(false);
    });
  });

  describe('getSharedMethods', () => {
    it('returns methods visible to a grantee via active shares', () => {
      const svc = freshService();
      const m1 = makeMethod({ id: 'pm_shared' });
      const m2 = makeMethod({ id: 'pm_private' });
      const share: PaymentMethodShare = {
        id: 'sh_1',
        methodId: m1.id,
        granteeId: '0xGrantee',
        role: 'viewer',
        spendLimit: null,
        expiresAt: null,
        createdAt: new Date(),
        revokedAt: null,
      };
      const result = svc.getSharedMethods([m1, m2], [share], '0xGrantee');
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(m1);
    });
  });

  // ── processPaymentWithFallback (legacy) ───────────────────────────────────

  describe('processPaymentWithFallback', () => {
    it('throws when no methods are available', async () => {
      const svc = freshService();
      await expect(
        svc.processPaymentWithFallback([], 'sub_1', '10', 1)
      ).rejects.toBeInstanceOf(PaymentMethodError);
    });

    it('succeeds when primary method has sufficient balance', async () => {
      const svc = freshService();
      const m = makeMethod({ id: 'pm_ok' });
      jest.spyOn(svc, 'validateGasPrice').mockResolvedValue({ acceptable: true, currentGasPrice: '20' });
      jest.spyOn(svc, 'checkBalance').mockResolvedValue({ sufficient: true, balance: '1000', symbol: 'ETH' });

      const result = await svc.processPaymentWithFallback([m], 'sub_1', '10', 1);
      expect(result.success).toBe(true);
      expect(result.attempt.paymentMethodId).toBe('pm_ok');
    });
  });
});
