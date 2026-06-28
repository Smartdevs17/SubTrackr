# Integration Test Documentation

## Overview

This document describes the integration test suite for SubTrackr, covering component interactions across the store, notification service, wallet connection, and backend API layers.

## Test Structure

```
app/tests/integration/
├── factories.ts                          # Shared test data factories
├── contract-store.integration.test.ts   # Contract ↔ store interaction
├── wallet-connection.integration.test.ts # Wallet connect/disconnect lifecycle
└── notification-delivery.integration.test.ts # Notification scheduling & delivery

backend/tests/integration/
└── api-endpoints.integration.test.ts    # MonitoringService & AlertingService pipeline
```

## Running Integration Tests

```bash
# Run all tests (includes integration)
npm test

# Run only integration tests
npx jest --testPathPattern="integration"

# Run with coverage
npx jest --coverage --testPathPattern="integration"
```

## Test Suites

### 1. Contract–Store Interaction (`contract-store.integration.test.ts`)

Verifies that `subscriptionStore` correctly integrates with `notificationService` on every mutation.

| Test                                           | What it verifies                         |
| ---------------------------------------------- | ---------------------------------------- |
| addSubscription calls syncRenewalReminders     | Notification sync fires after add        |
| updateSubscription propagates updated list     | Sync receives updated subscription data  |
| deleteSubscription syncs after removal         | Deleted sub is absent from sync payload  |
| recordBillingOutcome success                   | Charge-success notification is presented |
| recordBillingOutcome failure                   | Charge-failed notification is presented  |
| notificationsEnabled=false skips notifications | No notification when opted out           |
| Stats after add → toggle → delete              | Stats stay consistent across lifecycle   |
| categoryBreakdown accuracy                     | Breakdown reflects multiple categories   |

### 2. Wallet Connection (`wallet-connection.integration.test.ts`)

Verifies the `walletStore` connect/disconnect lifecycle and crypto-stream management.

| Test                                     | What it verifies                          |
| ---------------------------------------- | ----------------------------------------- |
| connectWallet persists to AsyncStorage   | Wallet data written on first connect      |
| connectWallet restores from AsyncStorage | Saved wallet loaded without re-writing    |
| disconnect clears state and storage      | State nulled, AsyncStorage key removed    |
| connect → disconnect → reconnect         | Full round-trip restores wallet           |
| disconnect error handling                | Error state set when storage throws       |
| isLoading resets after operations        | Loading flag always clears                |
| createCryptoStream then cancel           | Stream created active, cancelled inactive |

### 3. Notification Delivery (`notification-delivery.integration.test.ts`)

Verifies `notificationService` schedules, cancels, and presents notifications correctly.

| Test                                       | What it verifies                                   |
| ------------------------------------------ | -------------------------------------------------- |
| requestNotificationPermissions             | Returns GRANTED when already granted               |
| presentChargeSuccessNotification           | Schedules immediate notification with correct type |
| presentChargeFailedNotification            | Schedules immediate notification with correct type |
| Custom detail message                      | Body uses provided detail string                   |
| presentTransactionQueueNotification        | Correct title, body, and data type                 |
| syncRenewalReminders cancels old reminders | Existing renewal reminders cancelled first         |
| Inactive subscription skipped              | No schedule for inactive subs                      |
| notificationsEnabled=false skipped         | No schedule when opted out                         |
| Active sub with future date scheduled      | Reminder scheduled for eligible subs               |
| Unsupported platform skipped               | No-op on web/unsupported platforms                 |

### 4. API Endpoints (`backend/tests/integration/api-endpoints.integration.test.ts`)

Verifies `MonitoringService` and `AlertingService` end-to-end pipeline.

| Test                                | What it verifies                          |
| ----------------------------------- | ----------------------------------------- |
| recordTransaction → dashboard       | Transaction reflected in snapshot         |
| Mixed outcomes success rate         | Correct ratio calculated                  |
| Gas averaging                       | avgGasUsed computed correctly             |
| Empty dashboard defaults            | Safe zero values when no data             |
| addRule fires alert on breach       | Alert created when threshold exceeded     |
| resolveAlert removes from active    | Resolved alerts excluded                  |
| removeRule stops future alerts      | Removed rule no longer triggers           |
| recentMetrics includes failure_rate | Metrics emitted after each transaction    |
| dispatch idempotency                | Same alert dispatched only once           |
| dispatchAll skips resolved          | Resolved alerts not re-dispatched         |
| createDispatcher validation         | Throws when webhookUrl missing            |
| Full pipeline                       | Transactions → metrics → alert → dispatch |

## Test Data Factories (`factories.ts`)

Factories provide minimal, deterministic fixtures. Use `resetIdCounter()` in `beforeEach` to ensure stable IDs across tests.

```typescript
import {
  makeSubscriptionFormData,
  makeSubscription,
  makeWallet,
  makeCryptoStream,
  resetIdCounter,
} from './factories';

// Override any field
const sub = makeSubscription({ price: 19.99, billingCycle: BillingCycle.YEARLY });
const wallet = makeWallet({ address: '0xCustomAddress' });
```

## Design Principles

- **No disk I/O**: AsyncStorage is replaced with an in-memory map.
- **No real timers**: `jest.useFakeTimers()` controls async delays.
- **No network calls**: All external services are mocked at the module boundary.
- **Minimal fixtures**: Factories produce only the fields needed; tests override what they care about.
- **Isolated state**: Each test resets store state in `beforeEach` to prevent cross-test pollution.
