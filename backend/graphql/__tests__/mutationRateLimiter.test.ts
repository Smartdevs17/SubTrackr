import {
  analyzeMutationCost,
  InMemoryMutationRateLimitStore,
  GraphQLMutationRateLimiter,
  createMutationRateLimitMiddleware,
  DocumentNode,
} from '../middleware/mutationRateLimiter';

describe('GraphQL Mutation Rate Limiter', () => {
  const queryDoc: DocumentNode = {
    definitions: [
      {
        kind: 'OperationDefinition',
        operation: 'query',
        selectionSet: {
          selections: [
            { kind: 'Field', name: { value: 'subscriptions' } },
            { kind: 'Field', name: { value: 'userProfile' } },
          ],
        },
      },
    ],
  };

  const singleMutationDoc: DocumentNode = {
    definitions: [
      {
        kind: 'OperationDefinition',
        operation: 'mutation',
        selectionSet: {
          selections: [
            { kind: 'Field', name: { value: 'createSubscription' } },
          ],
        },
      },
    ],
  };

  const multiMutationDoc: DocumentNode = {
    definitions: [
      {
        kind: 'OperationDefinition',
        operation: 'mutation',
        selectionSet: {
          selections: [
            { kind: 'Field', name: { value: 'createSubscription' } },
            { kind: 'Field', name: { value: 'cancelSubscription' } },
          ],
        },
      },
    ],
  };

  describe('analyzeMutationCost', () => {
    test('returns false for query operations', () => {
      const result = analyzeMutationCost(queryDoc);
      expect(result.isMutation).toBe(false);
      expect(result.totalCost).toBe(0);
      expect(result.mutationNames).toEqual([]);
    });

    test('calculates default cost for mutation operations', () => {
      const result = analyzeMutationCost(singleMutationDoc);
      expect(result.isMutation).toBe(true);
      expect(result.mutationNames).toEqual(['createSubscription']);
      expect(result.totalCost).toBe(1);
    });

    test('calculates custom cost overrides for mutations', () => {
      const result = analyzeMutationCost(multiMutationDoc, {
        defaultCost: 1,
        mutationCosts: { createSubscription: 3, cancelSubscription: 5 },
      });
      expect(result.isMutation).toBe(true);
      expect(result.mutationNames).toEqual(['createSubscription', 'cancelSubscription']);
      expect(result.totalCost).toBe(8); // 3 + 5
    });
  });

  describe('InMemoryMutationRateLimitStore', () => {
    let store: InMemoryMutationRateLimitStore;

    beforeEach(() => {
      store = new InMemoryMutationRateLimitStore();
    });

    afterEach(() => {
      store.destroy();
    });

    test('increments counter and sets resetTime', () => {
      const res1 = store.increment('user:101', 2, 60000);
      expect(res1.total).toBe(2);

      const res2 = store.increment('user:101', 3, 60000);
      expect(res2.total).toBe(5);
    });

    test('resets key correctly', () => {
      store.increment('user:101', 5, 60000);
      store.reset('user:101');
      expect(store.get('user:101')).toBeNull();
    });
  });

  describe('GraphQLMutationRateLimiter', () => {
    let store: InMemoryMutationRateLimitStore;

    beforeEach(() => {
      store = new InMemoryMutationRateLimitStore();
    });

    afterEach(() => {
      store.destroy();
    });

    test('allows mutations within limit', async () => {
      const limiter = new GraphQLMutationRateLimiter({
        windowMs: 60000,
        maxMutations: 5,
        store,
      });

      const ctx = { user: { id: 'usr_abc' } };
      const status1 = await limiter.check(singleMutationDoc, ctx);
      expect(status1.allowed).toBe(true);
      expect(status1.remaining).toBe(4);
      expect(status1.clientKey).toBe('user:usr_abc');
    });

    test('blocks mutations exceeding limit', async () => {
      const limiter = new GraphQLMutationRateLimiter({
        windowMs: 60000,
        maxMutations: 2,
        store,
      });

      const ctx = { user: { id: 'usr_xyz' } };
      await limiter.check(singleMutationDoc, ctx); // 1
      await limiter.check(singleMutationDoc, ctx); // 2

      const status3 = await limiter.check(singleMutationDoc, ctx); // 3 (exceeds 2)
      expect(status3.allowed).toBe(false);
      expect(status3.remaining).toBe(0);
    });

    test('does not consume quota for pure queries', async () => {
      const limiter = new GraphQLMutationRateLimiter({
        windowMs: 60000,
        maxMutations: 2,
        store,
      });

      const ctx = { user: { id: 'usr_query' } };
      const resQuery = await limiter.check(queryDoc, ctx);
      expect(resQuery.allowed).toBe(true);
      expect(resQuery.currentCost).toBe(0);
      expect(resQuery.remaining).toBe(2);
    });
  });

  describe('createMutationRateLimitMiddleware', () => {
    let store: InMemoryMutationRateLimitStore;

    beforeEach(() => {
      store = new InMemoryMutationRateLimitStore();
    });

    afterEach(() => {
      store.destroy();
    });

    test('throws RATE_LIMIT_EXCEEDED error when quota exceeded', async () => {
      const middleware = createMutationRateLimitMiddleware({
        windowMs: 60000,
        maxMutations: 1,
        store,
      });

      const ctx = { ip: '127.0.0.1' };
      await middleware(singleMutationDoc, ctx);

      await expect(middleware(singleMutationDoc, ctx)).rejects.toThrow(
        /GraphQL mutation rate limit exceeded/
      );
    });
  });
});
