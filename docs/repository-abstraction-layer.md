# Repository Abstraction Layer

Issue #2215 — Data mapper and repository pattern for flexible data storage.

## Overview

The repository abstraction layer isolates domain logic from data storage. It
provides:

1. **Repository interfaces** (`IRepository`, `ISubscriptionRepository`, …) —
   the contract every storage backend must fulfill.
2. **Data mappers** — pure functions that convert between domain entities and
   storage rows, separate from the repositories themselves.
3. **In-memory implementations** — for tests and local dev, no database needed.
4. **PostgreSQL implementations** — production-ready with parameterized queries
   and transaction support via `PostgresUnitOfWork`.
5. **Repository factory** — a single entry point to obtain repositories by
   backend type, isolating the rest of the app from the storage choice.

## Architecture

```
Service Layer
     │
     ▼
RepositoryFactory ──▶ RepositorySet
     │                      │
     │              ┌───────┼────────┐
     │              ▼       ▼        ▼
     │        Subscriptions  Transactions  Users  …
     │              │
     │        DataMapper (entity ↔ row conversion)
     │              │
     ▼              ▼
In-Memory    PostgreSQL
(backend)    (backend)
```

## Data Mappers

Each domain entity has a dedicated mapper implementing `IDataMapper<E, R>`:

| Entity | Mapper | Row Type |
|--------|--------|----------|
| Subscription | `SubscriptionDataMapper` | `SubscriptionRow` |
| Transaction | `TransactionDataMapper` | `TransactionRow` |
| User | `UserDataMapper` | `UserRow` |
| Merchant | `MerchantDataMapper` | `MerchantRow` |
| Loyalty | `LoyaltyDataMapper` | `LoyaltyRow` |

Mappers handle:
- camelCase ↔ snake_case key conversion
- Date normalisation (string/number from DB → Date object)
- null ↔ undefined conversion for optional fields

### Usage

```typescript
import { SubscriptionDataMapper } from './repositories';

const mapper = new SubscriptionDataMapper();
const row = mapper.toRow(subscription);   // entity → row
const entity = mapper.toEntity(row);       // row → entity
```

### Registry

The `DataMapperRegistry` holds all mappers and lets repositories look them up
by name:

```typescript
import { dataMapperRegistry } from './repositories';

const subMapper = dataMapperRegistry.get<Subscription, SubscriptionRow>('subscription');
```

## Repository Factory

```typescript
import { createRepositorySet } from './repositories';

// In-memory (for tests)
const set = createRepositorySet({ backend: 'in-memory' });
const sub = await set.subscriptions.findById('sub_1');

// PostgreSQL (for production)
const pgSet = createRepositorySet({ backend: 'postgres', pool: myPool });
const result = await pgSet.unitOfWork.run(async (uow) => {
  const sub = await uow.subscriptions.findById('sub_1');
  await uow.transactions.save({ ... });
  return sub;
});
```

### Singleton Access

```typescript
import { initRepositoryFactory, getRepositorySet } from './repositories';

// At startup:
initRepositoryFactory({ backend: 'postgres', pool });

// Anywhere:
const { subscriptions, transactions } = getRepositorySet();
```

## Unit of Work

The `IUnitOfWork` interface provides atomic transactions across multiple
repositories. If the `work` function throws, the transaction rolls back.

```typescript
await unitOfWork.run(async (uow) => {
  const sub = await uow.subscriptions.findById('sub_1');
  await uow.transactions.save({ id: 'tx_new', ... });
  // Both operations commit together, or both roll back on error.
});
```

## Testing

```bash
npx jest --config jest.backend.config.js \
  --testMatch '**/backend/services/repositories/__tests__/**/*.test.ts' \
  --coverage
```

Coverage: 93% statements, 85% branches, 94% functions, 94% lines across 78 tests.
