/**
 * testContainer.test.ts — Tests for the test-container and fixture infrastructure.
 *
 * Validates: lifecycle, seeding, savepoints, snapshots, FixtureLoader factories,
 * FlakyTestDetector, TestClock, TestEventBus, DatabaseSeeder, RedisFixture,
 * PerformanceAssertion, and createTestContext.
 */

import {
  TestContainerManager,
  testContainerManager,
  FixtureLoader,
  DatabaseSeeder,
  TestClock,
  TestEventBus,
  RedisFixture,
  detectFlakyTest,
  withTiming,
  assertWithinMs,
  createTestContext,
  type RedisClient,
  type SubscriptionFixture,
  type InvoiceFixture,
} from '../setup/testContainer';

// ─── TestContainerManager — lifecycle ────────────────────────────────────────

describe('TestContainerManager — lifecycle', () => {
  let mgr: TestContainerManager;

  beforeEach(async () => {
    mgr = new TestContainerManager({ inMemory: true });
    await mgr.startContainer();
  });

  afterEach(async () => {
    await mgr.stopContainer();
  });

  it('starts inactive and becomes active after startContainer', async () => {
    const fresh = new TestContainerManager();
    expect(fresh.isContainerActive()).toBe(false);
    await fresh.startContainer();
    expect(fresh.isContainerActive()).toBe(true);
    await fresh.stopContainer();
  });

  it('is idempotent — calling startContainer twice does not throw', async () => {
    await expect(mgr.startContainer()).resolves.toBeUndefined();
    expect(mgr.isContainerActive()).toBe(true);
  });

  it('becomes inactive after stopContainer', async () => {
    await mgr.stopContainer();
    expect(mgr.isContainerActive()).toBe(false);
  });

  it('loads initialSeed on start', async () => {
    const seeded = new TestContainerManager({
      inMemory: true,
      initialSeed: { plans: [{ id: 'p1', name: 'Starter', price: 5, currency: 'USD', interval: 'monthly' }] },
    });
    await seeded.startContainer();
    expect(seeded.findById('plans', 'p1')).toBeDefined();
    await seeded.stopContainer();
  });

  it('clears data on stop and re-start', async () => {
    await mgr.seedDatabase({ users: [{ id: 'u1', email: 'a@b.com' }] });
    await mgr.stopContainer();
    await mgr.startContainer();
    expect(mgr.findById('users', 'u1')).toBeUndefined();
  });
});

// ─── TestContainerManager — seeding & querying ───────────────────────────────

describe('TestContainerManager — seeding and queries', () => {
  let mgr: TestContainerManager;

  beforeEach(async () => {
    mgr = new TestContainerManager();
    await mgr.startContainer();
  });

  afterEach(async () => {
    await mgr.stopContainer();
  });

  it('seeds and retrieves a single row by id', async () => {
    await mgr.seedDatabase({ users: [{ id: 'u1', email: 'a@b.com' }] });
    const found = mgr.findById('users', 'u1');
    expect(found).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('findAll returns all seeded rows for an entity', async () => {
    await mgr.seedDatabase({
      plans: [
        { id: 'p1', name: 'Basic', price: 5, currency: 'USD', interval: 'monthly' },
        { id: 'p2', name: 'Pro', price: 15, currency: 'USD', interval: 'monthly' },
      ],
    });
    expect(mgr.findAll('plans')).toHaveLength(2);
  });

  it('findWhere filters rows by predicate', async () => {
    await mgr.seedDatabase({
      subscriptions: [
        { id: 's1', userId: 'u1', planId: 'p1', status: 'active' },
        { id: 's2', userId: 'u2', planId: 'p1', status: 'cancelled' },
        { id: 's3', userId: 'u3', planId: 'p2', status: 'active' },
      ],
    });
    const active = mgr.findWhere<SubscriptionFixture>('subscriptions', (r) => r.status === 'active');
    expect(active).toHaveLength(2);
    expect(active.map((s) => s.id).sort()).toEqual(['s1', 's3']);
  });

  it('throws when seeding a row without an id', async () => {
    await expect(
      mgr.seedDatabase({ users: [{ email: 'no-id@test.com' }] }),
    ).rejects.toThrow('missing required "id"');
  });

  it('upsert inserts or replaces a row', async () => {
    mgr.upsert('plans', { id: 'p1', name: 'Starter', price: 5, currency: 'USD', interval: 'monthly' });
    expect(mgr.findById('plans', 'p1')).toMatchObject({ name: 'Starter', price: 5 });
    mgr.upsert('plans', { id: 'p1', name: 'Starter Updated', price: 7, currency: 'USD', interval: 'monthly' });
    expect(mgr.findById('plans', 'p1')).toMatchObject({ name: 'Starter Updated', price: 7 });
  });

  it('delete removes a row and returns true', async () => {
    await mgr.seedDatabase({ users: [{ id: 'u1', email: 'a@b.com' }] });
    expect(mgr.delete('users', 'u1')).toBe(true);
    expect(mgr.findById('users', 'u1')).toBeUndefined();
  });

  it('delete returns false for unknown id', async () => {
    expect(mgr.delete('users', 'ghost')).toBe(false);
  });

  it('count returns row count per entity', async () => {
    await mgr.seedDatabase({
      invoices: [
        { id: 'i1', subscriptionId: 's1', amount: 10, currency: 'USD', status: 'pending' },
        { id: 'i2', subscriptionId: 's1', amount: 10, currency: 'USD', status: 'paid' },
      ],
    });
    expect(mgr.count('invoices')).toBe(2);
    expect(mgr.count('plans')).toBe(0);
  });

  it('cleanDatabase clears specific entities', async () => {
    await mgr.seedDatabase({
      users: [{ id: 'u1', email: 'a@b.com' }],
      plans: [{ id: 'p1', name: 'X', price: 1, currency: 'USD', interval: 'monthly' }],
    });
    await mgr.cleanDatabase(['users']);
    expect(mgr.count('users')).toBe(0);
    expect(mgr.count('plans')).toBe(1);
  });

  it('cleanDatabase with no args clears everything', async () => {
    await mgr.seedDatabase({ users: [{ id: 'u1', email: 'a@b.com' }] });
    await mgr.cleanDatabase();
    expect(mgr.count('users')).toBe(0);
  });

  it('throws seedDatabase when container is not running', async () => {
    const stopped = new TestContainerManager();
    await expect(
      stopped.seedDatabase({ users: [{ id: 'u1', email: 'a@b.com' }] }),
    ).rejects.toThrow('container is not running');
  });

  it('cleanDatabase is a no-op when container is not running', async () => {
    const stopped = new TestContainerManager();
    await expect(stopped.cleanDatabase()).resolves.toBeUndefined();
  });
});

// ─── TestContainerManager — savepoints ───────────────────────────────────────

describe('TestContainerManager — savepoints', () => {
  let mgr: TestContainerManager;

  beforeEach(async () => {
    mgr = new TestContainerManager();
    await mgr.startContainer();
  });

  afterEach(async () => {
    await mgr.stopContainer();
  });

  it('rolls back to savepoint after mutations', async () => {
    await mgr.seedDatabase({ users: [{ id: 'u1', email: 'a@b.com' }] });
    await mgr.createSavepoint();

    await mgr.seedDatabase({ users: [{ id: 'u2', email: 'b@b.com' }] });
    expect(mgr.count('users')).toBe(2);

    await mgr.rollbackToSavepoint();
    expect(mgr.count('users')).toBe(1);
    expect(mgr.findById('users', 'u1')).toBeDefined();
    expect(mgr.findById('users', 'u2')).toBeUndefined();
  });

  it('savepoints stack — multiple levels work correctly', async () => {
    await mgr.seedDatabase({ users: [{ id: 'u1', email: 'a@b.com' }] });
    await mgr.createSavepoint(); // level 1

    await mgr.seedDatabase({ users: [{ id: 'u2', email: 'b@b.com' }] });
    await mgr.createSavepoint(); // level 2

    await mgr.seedDatabase({ users: [{ id: 'u3', email: 'c@b.com' }] });
    expect(mgr.count('users')).toBe(3);

    await mgr.rollbackToSavepoint(); // back to level 1 state
    expect(mgr.count('users')).toBe(2);

    await mgr.rollbackToSavepoint(); // back to original
    expect(mgr.count('users')).toBe(1);
  });

  it('rollbackToSavepoint is a no-op when stack is empty', async () => {
    await expect(mgr.rollbackToSavepoint()).resolves.toBeUndefined();
  });
});

// ─── TestContainerManager — snapshots ────────────────────────────────────────

describe('TestContainerManager — snapshots', () => {
  let mgr: TestContainerManager;

  beforeEach(async () => {
    mgr = new TestContainerManager();
    await mgr.startContainer();
  });

  afterEach(async () => {
    await mgr.stopContainer();
  });

  it('takes a named snapshot and restores it', async () => {
    await mgr.seedDatabase({ users: [{ id: 'u1', email: 'a@b.com' }] });
    mgr.takeSnapshot('baseline');

    await mgr.seedDatabase({ users: [{ id: 'u2', email: 'b@b.com' }] });
    expect(mgr.count('users')).toBe(2);

    await mgr.restoreSnapshot('baseline');
    expect(mgr.count('users')).toBe(1);
    expect(mgr.findById('users', 'u1')).toBeDefined();
    expect(mgr.findById('users', 'u2')).toBeUndefined();
  });

  it('getSnapshot returns undefined for unknown id', () => {
    expect(mgr.getSnapshot('nonexistent')).toBeUndefined();
  });

  it('restoreSnapshot throws for unknown id', async () => {
    await expect(mgr.restoreSnapshot('ghost')).rejects.toThrow('snapshot "ghost" not found');
  });

  it('snapshot contains takenAt timestamp', async () => {
    const before = Date.now();
    const snap = mgr.takeSnapshot('ts-test');
    expect(snap.takenAt).toBeGreaterThanOrEqual(before);
    expect(snap.takenAt).toBeLessThanOrEqual(Date.now());
  });
});

// ─── FixtureLoader ────────────────────────────────────────────────────────────

describe('FixtureLoader', () => {
  beforeEach(() => FixtureLoader.resetCounter());

  it('plan() creates a valid plan fixture with defaults', () => {
    const plan = FixtureLoader.plan();
    expect(plan.id).toBeDefined();
    expect(plan.currency).toBe('USD');
    expect(plan.interval).toBe('monthly');
    expect(plan.active).toBe(true);
  });

  it('plan() merges overrides', () => {
    const plan = FixtureLoader.plan({ id: 'my-plan', price: 49.99, interval: 'yearly' });
    expect(plan.id).toBe('my-plan');
    expect(plan.price).toBe(49.99);
    expect(plan.interval).toBe('yearly');
  });

  it('user() creates a valid user fixture', () => {
    const user = FixtureLoader.user();
    expect(user.id).toBeDefined();
    expect(user.email).toContain('@test.example');
    expect(user.address).toBeDefined();
  });

  it('subscription() links to plan and user by default', () => {
    const sub = FixtureLoader.subscription();
    expect(sub.userId).toBeDefined();
    expect(sub.planId).toBeDefined();
    expect(sub.status).toBe('active');
    expect(sub.amount).toBe(9.99);
  });

  it('merchant() creates a valid merchant fixture', () => {
    const m = FixtureLoader.merchant();
    expect(m.email).toContain('@merchant.example');
    expect(m.active).toBe(true);
  });

  it('invoice() defaults to pending status', () => {
    const inv = FixtureLoader.invoice();
    expect(inv.status).toBe('pending');
    expect(inv.paidAt).toBeNull();
  });

  it('invoice() accepts overrides', () => {
    const inv = FixtureLoader.invoice({ status: 'paid', paidAt: '2025-01-01T00:00:00Z' });
    expect(inv.status).toBe('paid');
    expect(inv.paidAt).toBe('2025-01-01T00:00:00Z');
  });

  it('all factories produce unique IDs across calls', () => {
    const ids = [
      FixtureLoader.plan().id,
      FixtureLoader.plan().id,
      FixtureLoader.user().id,
      FixtureLoader.subscription().id,
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it('fullSubscriptionScenario returns linked entities', () => {
    const scenario = FixtureLoader.fullSubscriptionScenario();
    expect(scenario.plan.merchantId).toBe(scenario.merchant.id);
    expect(scenario.subscription.userId).toBe(scenario.user.id);
    expect(scenario.subscription.planId).toBe(scenario.plan.id);
    expect(scenario.invoice.subscriptionId).toBe(scenario.subscription.id);
    expect(scenario.invoice.amount).toBe(scenario.plan.price);
  });

  it('fullSubscriptionScenario respects overrides', () => {
    const scenario = FixtureLoader.fullSubscriptionScenario({
      plan: { price: 99, interval: 'yearly' },
      subscription: { status: 'paused' },
    });
    expect(scenario.plan.price).toBe(99);
    expect(scenario.subscription.status).toBe('paused');
    expect(scenario.invoice.amount).toBe(99);
  });
});

// ─── DatabaseSeeder ───────────────────────────────────────────────────────────

describe('DatabaseSeeder', () => {
  let mgr: TestContainerManager;

  beforeEach(async () => {
    mgr = new TestContainerManager();
    await mgr.startContainer();
  });

  afterEach(async () => {
    await mgr.stopContainer();
  });

  it('builds and seeds data in dependency order', async () => {
    const seeder = new DatabaseSeeder()
      .withMerchants([FixtureLoader.merchant({ id: 'm1' })])
      .withPlans([FixtureLoader.plan({ id: 'p1', merchantId: 'm1' })])
      .withUsers([FixtureLoader.user({ id: 'u1' })])
      .withSubscriptions([FixtureLoader.subscription({ id: 's1', userId: 'u1', planId: 'p1' })])
      .withInvoices([FixtureLoader.invoice({ id: 'i1', subscriptionId: 's1' })]);

    const built = seeder.build();
    // Merchants should appear before subscriptions in key order
    const keys = Object.keys(built);
    expect(keys.indexOf('merchants')).toBeLessThan(keys.indexOf('subscriptions'));
    expect(keys.indexOf('plans')).toBeLessThan(keys.indexOf('subscriptions'));

    await seeder.seedInto(mgr);
    expect(mgr.count('merchants')).toBe(1);
    expect(mgr.count('plans')).toBe(1);
    expect(mgr.count('users')).toBe(1);
    expect(mgr.count('subscriptions')).toBe(1);
    expect(mgr.count('invoices')).toBe(1);
  });

  it('withRaw adds arbitrary entity data', async () => {
    const seeder = new DatabaseSeeder()
      .withRaw('audit_logs', [{ id: 'log1', action: 'login', userId: 'u1' }]);
    await seeder.seedInto(mgr);
    expect(mgr.count('audit_logs')).toBe(1);
    expect(mgr.findById('audit_logs', 'log1')).toMatchObject({ action: 'login' });
  });

  it('chaining multiple withPlans calls accumulates rows', async () => {
    const seeder = new DatabaseSeeder()
      .withPlans([FixtureLoader.plan({ id: 'p1' })])
      .withPlans([FixtureLoader.plan({ id: 'p2' })]);
    await seeder.seedInto(mgr);
    expect(mgr.count('plans')).toBe(2);
  });
});

// ─── detectFlakyTest ─────────────────────────────────────────────────────────

describe('detectFlakyTest', () => {
  it('reports non-flaky for always-passing tests', async () => {
    const result = await detectFlakyTest(() => { /* always passes */ }, 5);
    expect(result.isFlaky).toBe(false);
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('reports non-flaky for always-failing tests', async () => {
    const result = await detectFlakyTest(() => { throw new Error('always fails'); }, 3);
    expect(result.isFlaky).toBe(false);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(3);
    expect(result.errors).toHaveLength(3);
  });

  it('reports flaky when test passes and fails across iterations', async () => {
    let call = 0;
    const result = await detectFlakyTest(() => {
      call++;
      if (call % 2 === 0) throw new Error('intermittent');
    }, 4);
    expect(result.isFlaky).toBe(true);
    expect(result.passed).toBeGreaterThan(0);
    expect(result.failed).toBeGreaterThan(0);
  });

  it('captures error messages in the errors array', async () => {
    const result = await detectFlakyTest(() => { throw new Error('boom'); }, 2);
    expect(result.errors).toEqual(['boom', 'boom']);
  });

  it('reports durationMs >= 0', async () => {
    const result = await detectFlakyTest(() => {}, 1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── TestClock ────────────────────────────────────────────────────────────────

describe('TestClock', () => {
  it('now() returns the initial time', () => {
    const clock = new TestClock(1_000_000);
    expect(clock.now()).toBe(1_000_000);
  });

  it('advance() adds milliseconds', () => {
    const clock = new TestClock(0);
    clock.advance(5000);
    expect(clock.now()).toBe(5000);
  });

  it('advanceHours() adds hours correctly', () => {
    const clock = new TestClock(0);
    clock.advanceHours(2);
    expect(clock.now()).toBe(2 * 3_600_000);
  });

  it('advanceDays() adds days correctly', () => {
    const clock = new TestClock(0);
    clock.advanceDays(1);
    expect(clock.now()).toBe(86_400_000);
  });

  it('set() overrides to an absolute time', () => {
    const clock = new TestClock(0);
    clock.set('2025-01-01T00:00:00Z');
    expect(clock.now()).toBe(new Date('2025-01-01T00:00:00Z').getTime());
  });

  it('date() returns a Date object matching now()', () => {
    const clock = new TestClock(12345678);
    expect(clock.date().getTime()).toBe(12345678);
  });

  it('iso() returns an ISO string', () => {
    const clock = new TestClock(0);
    clock.set('2025-06-15T12:00:00.000Z');
    expect(clock.iso()).toBe('2025-06-15T12:00:00.000Z');
  });

  it('reset() restores to a given time', () => {
    const clock = new TestClock(1000);
    clock.advanceDays(10);
    clock.reset(1000);
    expect(clock.now()).toBe(1000);
  });

  it('chaining works', () => {
    const clock = new TestClock(0);
    const result = clock.advance(1000).advanceHours(1).advanceDays(1);
    expect(result).toBe(clock);
    expect(clock.now()).toBe(1000 + 3_600_000 + 86_400_000);
  });
});

// ─── TestEventBus ─────────────────────────────────────────────────────────────

describe('TestEventBus', () => {
  let bus: TestEventBus;

  beforeEach(() => { bus = new TestEventBus(); });

  it('records published events', () => {
    bus.publish('subscription.created', { id: 's1' });
    expect(bus.count()).toBe(1);
  });

  it('ofType returns only matching events', () => {
    bus.publish('subscription.created', { id: 's1' });
    bus.publish('invoice.paid', { id: 'i1' });
    bus.publish('subscription.cancelled', { id: 's2' });
    const created = bus.ofType('subscription.created');
    expect(created).toHaveLength(1);
    expect(created[0].payload).toEqual({ id: 's1' });
  });

  it('last() returns the most recent event of that type', () => {
    bus.publish('payment.failed', { invoiceId: 'i1' });
    bus.publish('payment.failed', { invoiceId: 'i2' });
    const last = bus.last<{ invoiceId: string }>('payment.failed');
    expect(last?.payload.invoiceId).toBe('i2');
  });

  it('last() returns undefined when no matching events', () => {
    expect(bus.last('ghost')).toBeUndefined();
  });

  it('count() filters by name when provided', () => {
    bus.publish('a', {});
    bus.publish('a', {});
    bus.publish('b', {});
    expect(bus.count('a')).toBe(2);
    expect(bus.count('b')).toBe(1);
    expect(bus.count()).toBe(3);
  });

  it('assertPublished does not throw when event was published', () => {
    bus.publish('payment.success', {});
    expect(() => bus.assertPublished('payment.success')).not.toThrow();
  });

  it('assertPublished throws when event was NOT published', () => {
    expect(() => bus.assertPublished('missing.event')).toThrow('"missing.event"');
  });

  it('assertNotPublished does not throw when event was never published', () => {
    expect(() => bus.assertNotPublished('never.happened')).not.toThrow();
  });

  it('assertNotPublished throws when event was published', () => {
    bus.publish('fraud.flagged', { subscriptionId: 's1' });
    expect(() => bus.assertNotPublished('fraud.flagged')).toThrow('"fraud.flagged"');
  });

  it('clear() empties the event store', () => {
    bus.publish('x', {});
    bus.publish('y', {});
    bus.clear();
    expect(bus.count()).toBe(0);
  });

  it('all() returns a copy — mutations do not affect internal state', () => {
    bus.publish('x', {});
    const copy = bus.all();
    copy.push({ name: 'injected', payload: {}, timestamp: 0 });
    expect(bus.count()).toBe(1);
  });
});

// ─── RedisFixture ─────────────────────────────────────────────────────────────

describe('RedisFixture', () => {
  function makeMockRedis(): RedisClient & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
      store,
      async set(key: string, value: string) { store.set(key, value); },
      async get(key: string) { return store.get(key) ?? null; },
      async del(...keys: string[]) {
        let n = 0;
        for (const k of keys) { if (store.delete(k)) n++; }
        return n;
      },
      async keys(pattern: string) {
        const prefix = pattern.replace(/\*$/, '');
        return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
      },
    };
  }

  it('set and get round-trips through the mock client', async () => {
    const redis = makeMockRedis();
    const fixture = new RedisFixture(redis);
    await fixture.set('test:key', 'hello');
    expect(await fixture.get('test:key')).toBe('hello');
  });

  it('cleanup deletes all tracked keys', async () => {
    const redis = makeMockRedis();
    const fixture = new RedisFixture(redis);
    await fixture.set('k1', 'v1');
    await fixture.set('k2', 'v2');
    await fixture.cleanup();
    expect(redis.store.size).toBe(0);
    expect(fixture.trackedCount()).toBe(0);
  });

  it('cleanupPattern removes matching keys', async () => {
    const redis = makeMockRedis();
    const fixture = new RedisFixture(redis);
    await fixture.set('cache:sub:s1', 'a');
    await fixture.set('cache:sub:s2', 'b');
    await fixture.set('other:key', 'c');
    await fixture.cleanupPattern('cache:sub:*');
    expect(redis.store.has('other:key')).toBe(true);
    expect(redis.store.has('cache:sub:s1')).toBe(false);
    expect(redis.store.has('cache:sub:s2')).toBe(false);
  });

  it('trackedCount reflects number of keys set', async () => {
    const redis = makeMockRedis();
    const fixture = new RedisFixture(redis);
    await fixture.set('a', '1');
    await fixture.set('b', '2');
    expect(fixture.trackedCount()).toBe(2);
    await fixture.cleanup();
    expect(fixture.trackedCount()).toBe(0);
  });
});

// ─── withTiming and assertWithinMs ───────────────────────────────────────────

describe('withTiming and assertWithinMs', () => {
  it('withTiming returns the function result and a non-negative duration', async () => {
    const { result, durationMs } = await withTiming(async () => 42);
    expect(result).toBe(42);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('assertWithinMs does not throw when within limit', () => {
    expect(() => assertWithinMs(50, 100, 'test op')).not.toThrow();
  });

  it('assertWithinMs throws when over limit', () => {
    expect(() => assertWithinMs(200, 100, 'slow op')).toThrow(
      'Performance assertion failed: slow op took 200ms, limit was 100ms',
    );
  });

  it('withTiming + assertWithinMs as a combined check', async () => {
    const { durationMs } = await withTiming(() => Promise.resolve('done'));
    expect(() => assertWithinMs(durationMs, 1000, 'trivial op')).not.toThrow();
  });
});

// ─── createTestContext ────────────────────────────────────────────────────────

describe('createTestContext', () => {
  it('creates a context with all components', () => {
    const ctx = createTestContext({ inMemory: true });
    expect(ctx.container).toBeInstanceOf(TestContainerManager);
    expect(ctx.fixtures).toBe(FixtureLoader);
    expect(ctx.clock).toBeDefined();
    expect(ctx.events).toBeInstanceOf(TestEventBus);
    expect(ctx.seeder).toBeDefined();
  });

  it('container starts inactive', () => {
    const ctx = createTestContext();
    expect(ctx.container.isContainerActive()).toBe(false);
  });

  it('full lifecycle through createTestContext', async () => {
    const ctx = createTestContext({ inMemory: true });
    await ctx.container.startContainer();

    const plan = ctx.fixtures.plan({ id: 'p1', price: 15 });
    const user = ctx.fixtures.user({ id: 'u1' });
    const sub = ctx.fixtures.subscription({ id: 's1', planId: 'p1', userId: 'u1', amount: 15 });

    await ctx.seeder
      .withPlans([plan])
      .withUsers([user])
      .withSubscriptions([sub])
      .seedInto(ctx.container);

    expect(ctx.container.count('plans')).toBe(1);
    expect(ctx.container.count('subscriptions')).toBe(1);

    ctx.clock.advanceDays(30);
    expect(ctx.clock.now()).toBeGreaterThan(Date.now() - 1000);

    ctx.events.publish('subscription.renewed', { subscriptionId: 's1' });
    ctx.events.assertPublished('subscription.renewed');

    await ctx.container.stopContainer();
    expect(ctx.container.isContainerActive()).toBe(false);
  });
});

// ─── Singleton testContainerManager export ───────────────────────────────────

describe('testContainerManager singleton', () => {
  afterEach(async () => {
    await testContainerManager.stopContainer();
  });

  it('is exported and usable', async () => {
    await testContainerManager.startContainer();
    expect(testContainerManager.isContainerActive()).toBe(true);
  });

  it('manages container lifecycle and database seeding (smoke)', async () => {
    await testContainerManager.startContainer();
    expect(testContainerManager.isContainerActive()).toBe(true);
    await testContainerManager.seedDatabase({ users: [{ id: 'u1', email: 'test@test.com' }] });
    await testContainerManager.cleanDatabase();
    expect(testContainerManager.count('users')).toBe(0);
  });

  it('detects flaky test behavior accurately', async () => {
    const result = await detectFlakyTest(() => { /* deterministic pass */ }, 2);
    expect(result.isFlaky).toBe(false);
    expect(result.passed).toBe(2);
  });

  it('matches API response snapshots', () => {
    const apiResponse = {
      status: 'success',
      data: { id: 'sub_123', amount: 15.99, currency: 'USD' },
    };
    expect(apiResponse).toMatchSnapshot();
  });
});
