# Testing Infrastructure — Test Containers & Fixtures

This document describes the backend testing infrastructure introduced in `backend/tests/setup/testContainer.ts`.

---

## Overview

The test container system provides a fast, hermetic test environment for backend integration tests.  
It uses an **in-memory store by default**, meaning no real PostgreSQL or Redis instance is needed during unit and integration test runs. The same API surface works with real containers in CI by setting `inMemory: false`.

---

## Quick Start

```ts
import {
  createTestContext,
  FixtureLoader,
} from '../tests/setup/testContainer';

const ctx = createTestContext({ inMemory: true });

beforeAll(() => ctx.container.startContainer());
afterAll(() => ctx.container.stopContainer());
beforeEach(() => ctx.container.createSavepoint());
afterEach(() => ctx.container.rollbackToSavepoint());

it('charges an active subscription', async () => {
  const { subscription } = FixtureLoader.fullSubscriptionScenario();
  await ctx.seeder.withSubscriptions([subscription]).seedInto(ctx.container);

  // ... exercise your service ...

  ctx.events.assertPublished('payment.success');
});
```

---

## Components

### `TestContainerManager`

Manages environment lifecycle and provides a query API over the seeded data.

| Method | Description |
|---|---|
| `startContainer()` | Initialise store, load `initialSeed` if provided |
| `stopContainer()` | Tear down, clear all data |
| `seedDatabase(data)` | Insert rows into the in-memory store |
| `cleanDatabase(entities?)` | Delete all rows, or only named entities |
| `createSavepoint()` | Push a copy of the current state onto a stack |
| `rollbackToSavepoint()` | Pop and restore the last savepoint |
| `takeSnapshot(id)` | Named snapshot of current state |
| `restoreSnapshot(id)` | Restore a named snapshot |
| `findById(entity, id)` | Look up one row by primary key |
| `findAll(entity)` | All rows for an entity |
| `findWhere(entity, fn)` | Filtered rows |
| `upsert(entity, row)` | Insert or replace |
| `delete(entity, id)` | Remove a row |
| `count(entity)` | Row count for an entity |

**Per-test isolation pattern (recommended):**
```ts
beforeEach(() => container.createSavepoint());
afterEach(() => container.rollbackToSavepoint());
```

---

### `FixtureLoader`

Typed factory methods with sensible defaults.

```ts
const plan   = FixtureLoader.plan({ price: 29.99, interval: 'yearly' });
const user   = FixtureLoader.user({ email: 'alice@example.com' });
const sub    = FixtureLoader.subscription({ userId: user.id, planId: plan.id });
const inv    = FixtureLoader.invoice({ subscriptionId: sub.id, status: 'failed' });

// Or build a full linked scenario in one call:
const { merchant, plan, user, subscription, invoice } =
  FixtureLoader.fullSubscriptionScenario({
    plan: { price: 99, interval: 'yearly' },
    subscription: { status: 'past_due' },
  });
```

All factories auto-increment IDs. Call `FixtureLoader.resetCounter()` in `beforeEach` for deterministic IDs.

---

### `DatabaseSeeder`

Fluent builder that inserts data in dependency order (merchants → plans → users → subscriptions → invoices).

```ts
await new DatabaseSeeder()
  .withMerchants([merchant])
  .withPlans([plan])
  .withUsers([user])
  .withSubscriptions([sub])
  .withInvoices([inv])
  .seedInto(container);
```

---

### `TestClock`

Deterministic time for services that accept a `now` callback.

```ts
const clock = new TestClock(Date.now());
clock.advanceDays(30);   // simulate billing cycle
clock.advanceHours(2);   // move forward 2 hours
clock.set('2026-01-01'); // jump to absolute date
```

---

### `TestEventBus`

Captures published events without a real message broker.

```ts
const bus = new TestEventBus();
bus.publish('subscription.cancelled', { id: 's1', reason: 'non_payment' });

bus.assertPublished('subscription.cancelled');
bus.assertNotPublished('subscription.renewed');
expect(bus.count('subscription.cancelled')).toBe(1);
const last = bus.last<{ id: string }>('subscription.cancelled');
```

---

### `detectFlakyTest`

Run a test function multiple times and detect non-determinism.

```ts
const result = await detectFlakyTest(async () => {
  // your test body
}, 5 /* iterations */);

console.log(result.isFlaky);   // true if passed AND failed across runs
console.log(result.passed);    // number of passing runs
console.log(result.failed);    // number of failing runs
console.log(result.errors);    // error messages from failing runs
```

---

### `RedisFixture`

Tracks Redis keys created during a test for automatic cleanup.

```ts
const fixture = new RedisFixture(redisClient);
await fixture.set('cache:sub:s1', JSON.stringify(data), 60);
// ... test ...
await fixture.cleanup(); // deletes all tracked keys
```

---

### Performance helpers

```ts
const { result, durationMs } = await withTiming(() => myService.process());
assertWithinMs(durationMs, 200, 'process()');  // throws if > 200ms
```

---

## Running tests

```bash
# All backend tests (unit + integration)
npx jest --config jest.backend.config.js

# Only the test-container infrastructure tests
npx jest --config jest.backend.config.js backend/tests/integration/testContainer.test.ts

# With coverage
npx jest --config jest.backend.config.js --coverage
```

---

## Performance benchmarks

The in-memory store is intentionally lightweight:

| Operation | Target |
|---|---|
| `startContainer()` | < 5ms |
| `seedDatabase()` (100 rows) | < 2ms |
| `findWhere()` (1000 rows) | < 1ms |
| `createSavepoint()` / `rollbackToSavepoint()` | < 5ms |
| Full test context setup | < 10ms |

These are verified by the `withTiming` + `assertWithinMs` helpers in the test suite.
