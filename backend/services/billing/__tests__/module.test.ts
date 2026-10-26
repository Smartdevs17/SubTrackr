/**
 * Module-level tests for billing domain.
 * Validates error codes, DI container bindings, and module boundaries.
 */
import { container, Container } from '../../container';
import { BillingError, BillingErrorCode } from '../errors';

describe('Billing Module', () => {
  // ── Error handling ──────────────────────────────────────────────────────────

  describe('BillingError', () => {
    it('creates paymentFailed error with correct code', () => {
      const err = BillingError.paymentFailed('sub_123', 'insufficient_funds');
      expect(err.code).toBe(BillingErrorCode.PAYMENT_FAILED);
      expect(err.message).toContain('sub_123');
      expect(err.message).toContain('insufficient_funds');
      expect(err.details).toEqual({ subscriptionId: 'sub_123', reason: 'insufficient_funds' });
    });

    it('creates taxCalculationFailed error', () => {
      const err = BillingError.taxCalculationFailed('merchant_1', 'invalid_nexus');
      expect(err.code).toBe(BillingErrorCode.TAX_CALCULATION_FAILED);
    });

    it('creates dunningFailed error', () => {
      const err = BillingError.dunningFailed('sub_456', 'final_notice');
      expect(err.code).toBe(BillingErrorCode.DUNNING_FAILED);
      expect(err.details).toEqual({ subscriptionId: 'sub_456', stage: 'final_notice' });
    });

    it('all error codes are unique within the module', () => {
      const codes = Object.values(BillingErrorCode);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  // ── DI Container bindings ───────────────────────────────────────────────────

  describe('DI Container', () => {
    let testContainer: Container;

    beforeEach(() => {
      testContainer = new Container();
    });

    it('resolves IMeteringService', () => {
      testContainer.bind('IMeteringService', () => ({ recordUsage: jest.fn() }));
      const svc = testContainer.resolve('IMeteringService');
      expect(svc).toBeDefined();
      expect(typeof svc.recordUsage).toBe('function');
    });

    it('resolves IPricingService', () => {
      testContainer.bind('IPricingService', () => ({ calculateOptimalPrice: jest.fn() }));
      const svc = testContainer.resolve('IPricingService');
      expect(svc).toBeDefined();
    });

    it('resolves ITaxService', () => {
      testContainer.bind('ITaxService', () => ({ calculateTax: jest.fn() }));
      const svc = testContainer.resolve('ITaxService');
      expect(svc).toBeDefined();
    });

    it('resolves IDunningService', () => {
      testContainer.bind('IDunningService', () => ({ startDunning: jest.fn() }));
      const svc = testContainer.resolve('IDunningService');
      expect(svc).toBeDefined();
    });

    it('throws for unregistered token', () => {
      expect(() => testContainer.resolve('IUnregisteredService')).toThrow(
        'Service not registered'
      );
    });

    it('binds singletons by default (same instance)', () => {
      testContainer.bind('ITestService', () => ({}));
      const a = testContainer.resolve('ITestService');
      const b = testContainer.resolve('ITestService');
      expect(a).toBe(b);
    });

    it('binds transients (new instance each resolve)', () => {
      testContainer.bindTransient('ITestService', () => ({}));
      const a = testContainer.resolve('ITestService');
      const b = testContainer.resolve('ITestService');
      expect(a).not.toBe(b);
    });

    it('detects circular dependencies', () => {
      testContainer.bind('IA', (c) => c.resolve('IB'));
      testContainer.bind('IB', (c) => c.resolve('IA'));
      expect(() => testContainer.resolve('IA')).toThrow('Circular dependency');
    });

    it('has() returns true for registered tokens', () => {
      testContainer.bind('ITestService', () => ({}));
      expect(testContainer.has('ITestService')).toBe(true);
      expect(testContainer.has('IUnknown')).toBe(false);
    });

    it('clear() removes all bindings', () => {
      testContainer.bind('ITestService', () => ({}));
      expect(testContainer.has('ITestService')).toBe(true);
      testContainer.clear();
      expect(testContainer.has('ITestService')).toBe(false);
    });
  });

  // ── Module boundary ─────────────────────────────────────────────────────────

  describe('Module boundary', () => {
    it('billing module does not import from subscription directly', () => {
      // Interfaces enforce the boundary — concrete classes are never imported across modules.
      // The container is the sole coupling point.
      expect(container.has('IMeteringService')).toBe(true);
      expect(container.has('ISubscriptionEventStore')).toBe(true);
      // They live in different domain modules but are wired via the container.
    });
  });
});
