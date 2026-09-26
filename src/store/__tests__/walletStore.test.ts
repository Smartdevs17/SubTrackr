/**
 * Unit tests for useWalletStore — payment method management slice.
 *
 * The store is reset between tests via setState so each test starts clean.
 * ethers and the underlying services are fully mocked.
 */

import { act } from '@testing-library/react-native';
import { PaymentPriority, TokenType, PaymentMethod, FallbackChain } from '../../types/wallet';
import { PaymentMethodError, PaymentMethodErrorCode } from '../../services/paymentMethodService';

// ── Zustand persist storage mock ───────────────────────────────────────────

jest.mock('../../utils/storage', () => ({
  asyncStorageAdapter: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// ── WalletServiceManager mock ──────────────────────────────────────────────

const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockGetConnection = jest.fn().mockReturnValue({
  address: '0xUser',
  chainId: 1,
  isConnected: true,
});

jest.mock('../../services/walletService', () => ({
  WalletServiceManager: {
    getInstance: () => ({
      disconnectWallet: mockDisconnect,
      getConnection: mockGetConnection,
      addListener: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    }),
  },
}));

// ── PaymentMethodService mock ──────────────────────────────────────────────

const mockValidate        = jest.fn().mockReturnValue({ isValid: true, errors: [], warnings: [] });
const mockCanAdd          = jest.fn().mockReturnValue({ canAdd: true });
const mockIsDuplicate     = jest.fn().mockReturnValue(false);
const mockVerify          = jest.fn().mockResolvedValue(true);
const mockGenerateId      = jest.fn().mockImplementation(
  () => `pm_${Math.random().toString(36).slice(2, 8)}`
);
const mockCheckExpiry     = jest.fn().mockReturnValue({
  isExpired: false, isExpiringSoon: false, daysUntilExpiry: null,
});
const mockGetExpired      = jest.fn().mockReturnValue([]);
const mockBuildAlerts     = jest.fn().mockReturnValue([]);
const mockComputeAnalytics = jest.fn().mockReturnValue({
  totalAttempts: 0, totalSuccesses: 0, totalFailures: 0, successRate: 0,
  fallbackRate: 0, byMethod: [], failureReasons: [],
  mostReliableMethodId: null, activeMethods: 0, expiringMethods: 0,
});
const mockProcessFallback = jest.fn();
const mockValidateChain   = jest.fn().mockReturnValue({ isValid: true, errors: [], warnings: [] });
const mockSelectChain     = jest.fn().mockReturnValue(null);
const mockBuildDefaultChain = jest.fn().mockReturnValue({
  id: 'chain_default', name: 'Default', methodIds: [], subscriptionId: null,
  maxAttempts: 0, stopOnHardDecline: false, isActive: true,
  createdAt: new Date(), updatedAt: new Date(),
});
const mockProcessWithChain = jest.fn();
const mockDetectUpgrade   = jest.fn().mockResolvedValue({ upgraded: false });
const mockMarkExpired     = jest.fn().mockImplementation(
  (m: PaymentMethod) => ({ ...m, isActive: false })
);
const mockCreateShare     = jest.fn();
const mockIsShareActive   = jest.fn().mockReturnValue(true);
const mockGetSharedMethods = jest.fn().mockReturnValue([]);

jest.mock('../../services/paymentMethodService', () => ({
  PaymentMethodService: {
    getInstance: () => ({
      validatePaymentMethodForm: mockValidate,
      canAddMethod: mockCanAdd,
      isDuplicateMethod: mockIsDuplicate,
      verifyPaymentMethod: mockVerify,
      generateId: mockGenerateId,
      checkExpiry: mockCheckExpiry,
      getExpiredMethods: mockGetExpired,
      getExpiringSoonMethods: jest.fn().mockReturnValue([]),
      buildExpiryAlerts: mockBuildAlerts,
      computeAnalytics: mockComputeAnalytics,
      processPaymentWithFallback: mockProcessFallback,
      validateChain: mockValidateChain,
      selectChainForSubscription: mockSelectChain,
      buildDefaultChain: mockBuildDefaultChain,
      processPaymentWithChain: mockProcessWithChain,
      detectTokenContractUpgrade: mockDetectUpgrade,
      markPaymentMethodExpired: mockMarkExpired,
      createShare: mockCreateShare,
      isShareActive: mockIsShareActive,
      getSharedMethods: mockGetSharedMethods,
      getPrimaryMethods: jest.fn().mockReturnValue([]),
      getBackupMethods: jest.fn().mockReturnValue([]),
      getFallbackMethods: jest.fn().mockReturnValue([]),
      sortByPriority: (ms: PaymentMethod[]) => ms,
      getActiveVerifiedMethods: (ms: PaymentMethod[]) =>
        ms.filter((m) => m.isActive && m.isVerified),
    }),
  },
  PaymentMethodError,
  PaymentMethodErrorCode,
}));

// ── Store import (after mocks) ─────────────────────────────────────────────

import { useWalletStore } from '../../store/walletStore';

// ── Fixtures ───────────────────────────────────────────────────────────────

const NOW = new Date('2026-01-01T00:00:00Z');

function baseMethod(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: `pm_${Math.random().toString(36).slice(2, 8)}`,
    userId: '0xUser',
    tokenType: TokenType.NATIVE,
    tokenAddress: '0x0000000000000000000000000000000000000000',
    chainId: 1,
    label: 'Test method',
    priority: PaymentPriority.PRIMARY,
    maxSpendPerInterval: '100',
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

function baseChain(overrides: Partial<FallbackChain> = {}): FallbackChain {
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

function resetStore() {
  useWalletStore.setState({
    connection: { address: '0xUser', chainId: 1, isConnected: true },
    paymentMethods: [],
    paymentAttempts: [],
    fallbackChains: [],
    paymentMethodShares: [],
    isLoading: false,
    error: null,
    cryptoStreams: [],
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
  jest.clearAllMocks();
  // restore default mock returns after clearAllMocks
  mockGetConnection.mockReturnValue({ address: '0xUser', chainId: 1, isConnected: true });
  mockValidate.mockReturnValue({ isValid: true, errors: [], warnings: [] });
  mockCanAdd.mockReturnValue({ canAdd: true });
  mockIsDuplicate.mockReturnValue(false);
  mockVerify.mockResolvedValue(true);
  mockValidateChain.mockReturnValue({ isValid: true, errors: [], warnings: [] });
  mockDetectUpgrade.mockResolvedValue({ upgraded: false });
  mockGetExpired.mockReturnValue([]);
  mockBuildAlerts.mockReturnValue([]);
  mockComputeAnalytics.mockReturnValue({
    totalAttempts: 0, totalSuccesses: 0, totalFailures: 0, successRate: 0,
    fallbackRate: 0, byMethod: [], failureReasons: [],
    mostReliableMethodId: null, activeMethods: 0, expiringMethods: 0,
  });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useWalletStore — payment methods', () => {

  // addPaymentMethod ─────────────────────────────────────────────────────────

  describe('addPaymentMethod', () => {
    it('adds a new method to the store', async () => {
      mockGenerateId.mockReturnValue('pm_fixed01');

      await act(async () => {
        await useWalletStore.getState().addPaymentMethod({
          tokenType: TokenType.NATIVE,
          tokenAddress: '0x0000000000000000000000000000000000000000',
          chainId: 1,
          label: 'My wallet',
          priority: PaymentPriority.PRIMARY,
          maxSpendPerInterval: '100',
        });
      });

      const { paymentMethods } = useWalletStore.getState();
      expect(paymentMethods).toHaveLength(1);
      expect(paymentMethods[0].id).toBe('pm_fixed01');
      expect(paymentMethods[0].label).toBe('My wallet');
      expect(paymentMethods[0].isActive).toBe(true);
    });

    it('throws PaymentMethodError when wallet not connected', async () => {
      useWalletStore.setState({ connection: null });

      await expect(
        act(async () => {
          await useWalletStore.getState().addPaymentMethod({
            tokenType: TokenType.NATIVE,
            tokenAddress: '0x0',
            chainId: 1,
            label: 'x',
            priority: PaymentPriority.PRIMARY,
            maxSpendPerInterval: '10',
          });
        })
      ).rejects.toBeInstanceOf(PaymentMethodError);
    });

    it('throws when max methods limit reached', async () => {
      mockCanAdd.mockReturnValue({ canAdd: false, reason: 'Maximum of 10 reached.' });

      await expect(
        act(async () => {
          await useWalletStore.getState().addPaymentMethod({
            tokenType: TokenType.NATIVE,
            tokenAddress: '0x0',
            chainId: 1,
            label: 'overflow',
            priority: PaymentPriority.PRIMARY,
            maxSpendPerInterval: '10',
          });
        })
      ).rejects.toBeInstanceOf(PaymentMethodError);
    });

    it('throws when validation fails', async () => {
      mockValidate.mockReturnValue({ isValid: false, errors: ['Label required'], warnings: [] });

      await expect(
        act(async () => {
          await useWalletStore.getState().addPaymentMethod({
            tokenType: TokenType.NATIVE,
            tokenAddress: '0x0',
            chainId: 1,
            label: '',
            priority: PaymentPriority.PRIMARY,
            maxSpendPerInterval: '10',
          });
        })
      ).rejects.toBeInstanceOf(PaymentMethodError);
    });

    it('throws on duplicate method', async () => {
      mockIsDuplicate.mockReturnValue(true);

      await expect(
        act(async () => {
          await useWalletStore.getState().addPaymentMethod({
            tokenType: TokenType.NATIVE,
            tokenAddress: '0x0',
            chainId: 1,
            label: 'dup',
            priority: PaymentPriority.PRIMARY,
            maxSpendPerInterval: '10',
          });
        })
      ).rejects.toBeInstanceOf(PaymentMethodError);
    });

    it('sets isVerified=true automatically for NATIVE tokens', async () => {
      await act(async () => {
        await useWalletStore.getState().addPaymentMethod({
          tokenType: TokenType.NATIVE,
          tokenAddress: '0x0000000000000000000000000000000000000000',
          chainId: 1,
          label: 'Native',
          priority: PaymentPriority.PRIMARY,
          maxSpendPerInterval: '50',
        });
      });

      expect(useWalletStore.getState().paymentMethods[0].isVerified).toBe(true);
    });
  });

  // removePaymentMethod ──────────────────────────────────────────────────────

  describe('removePaymentMethod', () => {
    it('removes a method by id', async () => {
      const m = baseMethod({ id: 'pm_del' });
      useWalletStore.setState({ paymentMethods: [m] });

      await act(async () => {
        await useWalletStore.getState().removePaymentMethod('pm_del');
      });

      expect(useWalletStore.getState().paymentMethods).toHaveLength(0);
    });

    it('leaves other methods untouched', async () => {
      const keep = baseMethod({ id: 'pm_keep' });
      const gone = baseMethod({ id: 'pm_gone' });
      useWalletStore.setState({ paymentMethods: [keep, gone] });

      await act(async () => {
        await useWalletStore.getState().removePaymentMethod('pm_gone');
      });

      const { paymentMethods } = useWalletStore.getState();
      expect(paymentMethods).toHaveLength(1);
      expect(paymentMethods[0].id).toBe('pm_keep');
    });
  });

  // updatePaymentMethod ──────────────────────────────────────────────────────

  describe('updatePaymentMethod', () => {
    it('updates a field on the method', async () => {
      const m = baseMethod({ id: 'pm_upd', label: 'old' });
      useWalletStore.setState({ paymentMethods: [m] });

      await act(async () => {
        await useWalletStore.getState().updatePaymentMethod('pm_upd', { label: 'new' });
      });

      expect(useWalletStore.getState().paymentMethods[0].label).toBe('new');
    });

    it('bumps updatedAt to a later timestamp', async () => {
      const m = baseMethod({ id: 'pm_ts', updatedAt: NOW });
      useWalletStore.setState({ paymentMethods: [m] });

      await act(async () => {
        await useWalletStore.getState().updatePaymentMethod('pm_ts', { label: 'x' });
      });

      expect(
        useWalletStore.getState().paymentMethods[0].updatedAt.getTime()
      ).toBeGreaterThanOrEqual(NOW.getTime());
    });
  });

  // verifyPaymentMethod ──────────────────────────────────────────────────────

  describe('verifyPaymentMethod', () => {
    it('marks method as verified', async () => {
      const m = baseMethod({ id: 'pm_ver', isVerified: false });
      useWalletStore.setState({ paymentMethods: [m] });

      await act(async () => {
        await useWalletStore.getState().verifyPaymentMethod('pm_ver');
      });

      expect(useWalletStore.getState().paymentMethods[0].isVerified).toBe(true);
    });

    it('throws when method not found', async () => {
      await expect(
        act(async () => {
          await useWalletStore.getState().verifyPaymentMethod('pm_missing');
        })
      ).rejects.toThrow('Payment method not found');
    });
  });

  // setPaymentMethodPriority ─────────────────────────────────────────────────

  describe('setPaymentMethodPriority', () => {
    it('changes the priority field', async () => {
      const m = baseMethod({ id: 'pm_pri', priority: PaymentPriority.PRIMARY });
      useWalletStore.setState({ paymentMethods: [m] });

      await act(async () => {
        await useWalletStore.getState().setPaymentMethodPriority('pm_pri', PaymentPriority.BACKUP);
      });

      expect(useWalletStore.getState().paymentMethods[0].priority).toBe(PaymentPriority.BACKUP);
    });
  });

  // processPayment ───────────────────────────────────────────────────────────

  describe('processPayment', () => {
    it('appends attempt and updates lastUsedAt on success', async () => {
      const m = baseMethod({ id: 'pm_pay' });
      useWalletStore.setState({ paymentMethods: [m] });

      const mockAttempt = {
        id: 'att_1',
        paymentMethodId: 'pm_pay',
        subscriptionId: 'sub_1',
        amount: '10',
        tokenType: TokenType.NATIVE,
        status: 'success' as const,
        attemptedAt: new Date(),
        resolvedAt: new Date(),
      };
      mockProcessFallback.mockResolvedValue({
        success: true,
        attempt: mockAttempt,
        fallbackAttempts: [],
      });

      await act(async () => {
        await useWalletStore.getState().processPayment('sub_1', '10', 1);
      });

      const { paymentAttempts, paymentMethods } = useWalletStore.getState();
      expect(paymentAttempts).toHaveLength(1);
      expect(paymentMethods[0].lastUsedAt).not.toBeNull();
    });
  });

  // getExpiryInfo ────────────────────────────────────────────────────────────

  describe('getExpiryInfo', () => {
    it('returns structured expired/expiringSoon lists', () => {
      const expired = baseMethod({ id: 'pm_exp', expiresAt: new Date(0) });
      useWalletStore.setState({ paymentMethods: [expired] });

      mockGetExpired.mockReturnValue([expired]);
      mockCheckExpiry.mockReturnValue({
        method: expired, daysUntilExpiry: -2, isExpired: true, isExpiringSoon: false,
      });

      const info = useWalletStore.getState().getExpiryInfo();
      expect(info.expired).toHaveLength(1);
      expect(info.expired[0].isExpired).toBe(true);
    });
  });

  // getPaymentMethodsByPriority ──────────────────────────────────────────────

  describe('getPaymentMethodsByPriority', () => {
    it('returns an object with primary, backup, fallback arrays', () => {
      const result = useWalletStore.getState().getPaymentMethodsByPriority();
      expect(result).toHaveProperty('primary');
      expect(result).toHaveProperty('backup');
      expect(result).toHaveProperty('fallback');
    });
  });
});

// ── Fallback chains ────────────────────────────────────────────────────────

describe('useWalletStore — fallback chains', () => {

  describe('createFallbackChain', () => {
    it('adds chain to the store', () => {
      const m = baseMethod({ id: 'pm_c1' });
      useWalletStore.setState({ paymentMethods: [m] });

      act(() => {
        useWalletStore.getState().createFallbackChain('My chain', [m.id]);
      });

      const { fallbackChains } = useWalletStore.getState();
      expect(fallbackChains).toHaveLength(1);
      expect(fallbackChains[0].name).toBe('My chain');
      expect(fallbackChains[0].methodIds).toContain(m.id);
    });

    it('throws and sets error when validation fails', () => {
      mockValidateChain.mockReturnValue({ isValid: false, errors: ['No methods'], warnings: [] });

      expect(() => {
        act(() => {
          useWalletStore.getState().createFallbackChain('Bad chain', []);
        });
      }).toThrow(PaymentMethodError);

      expect(useWalletStore.getState().error).not.toBeNull();
    });

    it('sets optional subscriptionId', () => {
      const m = baseMethod({ id: 'pm_sub' });
      useWalletStore.setState({ paymentMethods: [m] });

      act(() => {
        useWalletStore.getState().createFallbackChain('Sub chain', [m.id], {
          subscriptionId: 'sub_42',
        });
      });

      expect(useWalletStore.getState().fallbackChains[0].subscriptionId).toBe('sub_42');
    });
  });

  describe('updateFallbackChain', () => {
    it('updates name', () => {
      const chain = baseChain({ id: 'chain_u', name: 'old' });
      useWalletStore.setState({ fallbackChains: [chain] });

      act(() => {
        useWalletStore.getState().updateFallbackChain('chain_u', { name: 'new' });
      });

      expect(useWalletStore.getState().fallbackChains[0].name).toBe('new');
    });
  });

  describe('deleteFallbackChain', () => {
    it('removes chain by id', () => {
      const chain = baseChain({ id: 'chain_d' });
      useWalletStore.setState({ fallbackChains: [chain] });

      act(() => {
        useWalletStore.getState().deleteFallbackChain('chain_d');
      });

      expect(useWalletStore.getState().fallbackChains).toHaveLength(0);
    });
  });

  describe('reorderFallbackChain', () => {
    it('replaces methodIds with new order', () => {
      const chain = baseChain({ id: 'chain_r', methodIds: ['a', 'b', 'c'] });
      useWalletStore.setState({ fallbackChains: [chain] });

      act(() => {
        useWalletStore.getState().reorderFallbackChain('chain_r', ['c', 'a', 'b']);
      });

      expect(useWalletStore.getState().fallbackChains[0].methodIds).toEqual(['c', 'a', 'b']);
    });
  });

  describe('validateFallbackChain', () => {
    it('returns null for unknown id', () => {
      expect(useWalletStore.getState().validateFallbackChain('unknown')).toBeNull();
    });

    it('returns validation result for known chain', () => {
      const chain = baseChain({ id: 'chain_v', methodIds: ['pm_1'] });
      useWalletStore.setState({ fallbackChains: [chain] });
      mockValidateChain.mockReturnValue({ isValid: true, errors: [], warnings: ['Only one method'] });

      const result = useWalletStore.getState().validateFallbackChain('chain_v');
      expect(result?.isValid).toBe(true);
      expect(result?.warnings).toHaveLength(1);
    });
  });

  describe('chainForSubscription', () => {
    it('delegates to paymentService.selectChainForSubscription', () => {
      const chain = baseChain({ subscriptionId: 'sub_99' });
      useWalletStore.setState({ fallbackChains: [chain] });
      mockSelectChain.mockReturnValue(chain);

      const result = useWalletStore.getState().chainForSubscription('sub_99');
      expect(result).toBe(chain);
    });
  });
});

// ── Expiry & alerts ────────────────────────────────────────────────────────

describe('useWalletStore — expiry', () => {

  describe('deactivateExpiredMethods', () => {
    it('deactivates expired methods and returns count', () => {
      const expired = baseMethod({ id: 'pm_e1', expiresAt: new Date(0) });
      useWalletStore.setState({ paymentMethods: [expired] });
      mockGetExpired.mockReturnValue([expired]);
      mockMarkExpired.mockReturnValue({ ...expired, isActive: false });

      let count = 0;
      act(() => {
        count = useWalletStore.getState().deactivateExpiredMethods();
      });

      expect(count).toBe(1);
      expect(useWalletStore.getState().paymentMethods[0].isActive).toBe(false);
    });

    it('returns 0 when nothing expired', () => {
      useWalletStore.setState({ paymentMethods: [baseMethod()] });
      mockGetExpired.mockReturnValue([]);

      let count = 0;
      act(() => {
        count = useWalletStore.getState().deactivateExpiredMethods();
      });

      expect(count).toBe(0);
    });
  });

  describe('expiryAlerts', () => {
    it('returns alerts from the service', () => {
      mockBuildAlerts.mockReturnValue([{ methodId: 'pm_x', severity: 'warning' }]);
      const alerts = useWalletStore.getState().expiryAlerts();
      expect(alerts).toHaveLength(1);
    });

    it('returns empty array when no alerts', () => {
      mockBuildAlerts.mockReturnValue([]);
      expect(useWalletStore.getState().expiryAlerts()).toHaveLength(0);
    });
  });
});

// ── Analytics ──────────────────────────────────────────────────────────────

describe('useWalletStore — analytics', () => {
  it('delegates to paymentService.computeAnalytics', () => {
    mockComputeAnalytics.mockReturnValue({ totalAttempts: 7, successRate: 0.9 });
    const analytics = useWalletStore.getState().paymentAnalytics();
    expect(analytics.totalAttempts).toBe(7);
    expect(mockComputeAnalytics).toHaveBeenCalled();
  });
});

// ── Sharing ────────────────────────────────────────────────────────────────

describe('useWalletStore — sharing', () => {

  describe('sharePaymentMethod', () => {
    it('adds share to store', () => {
      const m = baseMethod({ id: 'pm_sh' });
      useWalletStore.setState({ paymentMethods: [m] });

      const share = {
        id: 'sh_1', methodId: m.id, granteeId: '0xG', role: 'viewer' as const,
        spendLimit: null, expiresAt: null, createdAt: new Date(), revokedAt: null,
      };
      mockCreateShare.mockReturnValue(share);

      act(() => {
        useWalletStore.getState().sharePaymentMethod(m.id, '0xG', 'viewer');
      });

      expect(useWalletStore.getState().paymentMethodShares).toHaveLength(1);
      expect(useWalletStore.getState().paymentMethodShares[0].granteeId).toBe('0xG');
    });

    it('throws PaymentMethodError when method not found', () => {
      expect(() => {
        act(() => {
          useWalletStore.getState().sharePaymentMethod('pm_missing', '0xG', 'viewer');
        });
      }).toThrow(PaymentMethodError);
    });
  });

  describe('revokePaymentMethodShare', () => {
    it('sets revokedAt on the targeted share', () => {
      const share = {
        id: 'sh_rev', methodId: 'pm_1', granteeId: '0xG', role: 'viewer' as const,
        spendLimit: null, expiresAt: null, createdAt: new Date(), revokedAt: null,
      };
      useWalletStore.setState({ paymentMethodShares: [share] });

      act(() => {
        useWalletStore.getState().revokePaymentMethodShare('sh_rev');
      });

      expect(useWalletStore.getState().paymentMethodShares[0].revokedAt).not.toBeNull();
    });

    it('ignores already-revoked shares', () => {
      const alreadyRevoked = {
        id: 'sh_already', methodId: 'pm_1', granteeId: '0xG', role: 'viewer' as const,
        spendLimit: null, expiresAt: null, createdAt: new Date(),
        revokedAt: new Date('2025-01-01'),
      };
      useWalletStore.setState({ paymentMethodShares: [alreadyRevoked] });

      act(() => {
        useWalletStore.getState().revokePaymentMethodShare('sh_already');
      });

      // revokedAt should remain the original date, not updated
      expect(
        useWalletStore.getState().paymentMethodShares[0].revokedAt?.toISOString()
      ).toBe('2025-01-01T00:00:00.000Z');
    });
  });

  describe('sharesForMethod', () => {
    it('returns active shares for a method via service delegation', () => {
      const share = {
        id: 'sh_1', methodId: 'pm_1', granteeId: '0xG', role: 'viewer' as const,
        spendLimit: null, expiresAt: null, createdAt: new Date(), revokedAt: null,
      };
      useWalletStore.setState({ paymentMethodShares: [share] });
      mockIsShareActive.mockReturnValue(true);

      const result = useWalletStore.getState().sharesForMethod('pm_1');
      expect(result).toHaveLength(1);
    });
  });

  describe('methodsSharedWith', () => {
    it('delegates to paymentService.getSharedMethods', () => {
      const m = baseMethod({ id: 'pm_shared' });
      mockGetSharedMethods.mockReturnValue([m]);

      const result = useWalletStore.getState().methodsSharedWith('0xGrantee');
      expect(result).toContain(m);
    });
  });
});

// ── Disconnect ─────────────────────────────────────────────────────────────

describe('useWalletStore — disconnect', () => {
  it('clears all payment data and connection', async () => {
    useWalletStore.setState({
      paymentMethods: [baseMethod()],
      fallbackChains: [baseChain()],
      paymentAttempts: [],
      paymentMethodShares: [],
    });

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });

    const s = useWalletStore.getState();
    expect(s.paymentMethods).toHaveLength(0);
    expect(s.fallbackChains).toHaveLength(0);
    expect(s.paymentMethodShares).toHaveLength(0);
    expect(s.connection).toBeNull();
  });
});

// ── checkTokenContractUpgrade ──────────────────────────────────────────────

describe('useWalletStore — checkTokenContractUpgrade', () => {
  it('returns false when no upgrade detected', async () => {
    const m = baseMethod({ id: 'pm_code', tokenType: TokenType.USDC, tokenAddress: '0xToken' });
    useWalletStore.setState({ paymentMethods: [m] });
    mockDetectUpgrade.mockResolvedValue({ upgraded: false, newHash: '0xabc' });

    let result = false;
    await act(async () => {
      result = await useWalletStore.getState().checkTokenContractUpgrade('pm_code');
    });

    expect(result).toBe(false);
    // Hash should still be persisted
    expect(
      useWalletStore.getState().paymentMethods[0].metadata['token_code_hash']
    ).toBe('0xabc');
  });

  it('stores new hash and returns true when upgrade detected', async () => {
    const m = baseMethod({
      id: 'pm_upg',
      tokenType: TokenType.USDC,
      tokenAddress: '0xToken',
      metadata: { token_code_hash: '0xold' },
    });
    useWalletStore.setState({ paymentMethods: [m] });
    mockDetectUpgrade.mockResolvedValue({ upgraded: true, newHash: '0xnewhash' });

    let result = false;
    await act(async () => {
      result = await useWalletStore.getState().checkTokenContractUpgrade('pm_upg');
    });

    expect(result).toBe(true);
    expect(
      useWalletStore.getState().paymentMethods[0].metadata['token_code_hash']
    ).toBe('0xnewhash');
  });

  it('returns false when method id does not exist', async () => {
    let result = false;
    await act(async () => {
      result = await useWalletStore.getState().checkTokenContractUpgrade('pm_none');
    });
    expect(result).toBe(false);
  });
});
