/**
 * Module-level tests for subscription domain.
 * Validates error codes and DI container integration.
 */
import { Container } from '../../container';
import { SubscriptionError, SubscriptionErrorCode } from '../errors';

describe('Subscription Module', () => {
  // ── Error handling ──────────────────────────────────────────────────────────

  describe('SubscriptionError', () => {
    it('creates notFound error with id', () => {
      const err = SubscriptionError.notFound('sub_xyz');
      expect(err.code).toBe(SubscriptionErrorCode.NOT_FOUND);
      expect(err.message).toContain('sub_xyz');
      expect(err.details).toEqual({ id: 'sub_xyz' });
    });

    it('creates alreadyExists error', () => {
      const err = SubscriptionError.alreadyExists('sub_dup');
      expect(err.code).toBe(SubscriptionErrorCode.ALREADY_EXISTS);
    });

    it('creates invalidState error with expected and actual', () => {
      const err = SubscriptionError.invalidState('sub_1', 'active', 'cancelled');
      expect(err.code).toBe(SubscriptionErrorCode.INVALID_STATE);
      expect(err.details).toEqual({ id: 'sub_1', expected: 'active', actual: 'cancelled' });
    });

    it('all error codes are unique within the module', () => {
      const codes = Object.values(SubscriptionErrorCode);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  // ── DI Container bindings ───────────────────────────────────────────────────

  describe('DI Container', () => {
    let container: Container;

    beforeEach(() => {
      container = new Container();
    });

    it('resolves ISubscriptionEventStore', () => {
      container.bind('ISubscriptionEventStore', () => ({ append: jest.fn(), query: jest.fn() }));
      expect(container.resolve('ISubscriptionEventStore')).toBeDefined();
    });

    it('resolves IElasticsearchService', () => {
      container.bind('IElasticsearchService', () => ({ search: jest.fn(), indexDocument: jest.fn() }));
      expect(container.resolve('IElasticsearchService')).toBeDefined();
    });
  });
});
