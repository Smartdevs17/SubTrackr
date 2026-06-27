# Store Migration Guide

## Overview

The SubTrackr state management has been refactored from **~25 individual Zustand stores** to a **single combined store using Zustand's slices pattern**. This improves:

- **Modularity** – Each domain is a clean slice with typed interfaces
- **Cross-slice communication** – Slices access each other via `get()` without importing other stores
- **Performance** – Single store with optimized selectors
- **Testability** – Slices can be tested independently
- **Bundle size** – Single Zustand instance instead of many

## What Changed

### Before (individual stores)
```ts
// Each domain had its own store
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useInvoiceStore } from '../store/invoiceStore';

const subscriptions = useSubscriptionStore((s) => s.subscriptions);
const invoices = useInvoiceStore((s) => s.invoices);

// Cross-store access required importing the other store
import { useCalendarStore } from '../store/calendarStore';
useCalendarStore.getState().syncSubscriptionToCalendars(sub);
```

### After (combined store)
```ts
// Single store import
import { useStore } from '../store';

// Same selector pattern – just changed the hook name
const subscriptions = useStore((s) => s.subscriptions);
const invoices = useStore((s) => s.invoices);

// Cross-store access is now built-in (same get())
useStore.getState().syncSubscriptionToCalendars(sub);
```

## Migration Steps

### 1. Update imports (optional but recommended)

**Current hooks still work** – all old store names are re-exported from `src/store/index.ts` as aliases to the combined store. However, you'll get a deprecation warning.

To migrate fully:

```diff
- import { useSubscriptionStore } from '../store';
+ import { useStore } from '../store/combinedStore';

- const subscriptions = useSubscriptionStore((s) => s.subscriptions);
+ const subscriptions = useStore((s) => s.subscriptions);
```

### 2. Replace cross-store access

```diff
- import { useCalendarStore } from '../store/calendarStore';
- import { useGamificationStore } from '../store/gamificationStore';
+ import { useStore } from '../store';

- useCalendarStore.getState().syncSubscriptionToCalendars(sub);
+ useStore.getState().syncSubscriptionToCalendars(sub);

- useGamificationStore.getState().addPoints(10);
+ useStore.getState().addPoints(10);
```

### 3. Testing changes

For tests, update the store import:

```diff
- import { useSubscriptionStore } from '../store/subscriptionStore';
+ import { useStore } from '../store';

  // Reset state:
- useSubscriptionStore.setState({ subscriptions: [] });
+ useStore.setState({ subscriptions: [] });
```

## Understanding the Architecture

### Slice Organization

```
src/store/
├── slices/
│   ├── types.ts               # Combined AppState type
│   ├── billingSlice.ts         # Subscription, Invoice, Tax, Accounting, Usage, Cancellation
│   ├── walletSlice.ts          # Wallet, TransactionQueue, Merchant
│   ├── settingsSlice.ts        # Settings, User, Community
│   ├── engagementSlice.ts      # Webhook, Gamification, Loyalty, Affiliate
│   ├── riskSlice.ts            # Fraud, SLA
│   ├── devSlice.ts             # Sandbox, DeveloperPortal
│   ├── marketingSlice.ts       # Campaign, Segment, Group
│   ├── calendarSlice.ts        # Calendar
│   ├── networkSlice.ts         # Network
│   ├── supportSlice.ts         # Support
│   ├── meteringSlice.ts        # Metering, Credit, Batch, Search
│   ├── billingAccoutingTypes.ts # Shared accounting types
│   └── transactionQueueTypes.ts # Shared transaction queue types
├── combinedStore.ts            # Combined store with persist
└── index.ts                    # Exports with backward-compatible aliases
```

### Adding a new slice

1. Create a new file in `slices/` with your slice interface and factory function
2. Add the interface to `slices/types.ts`
3. Import and compose the factory in `combinedStore.ts`
4. Add a re-export alias in `index.ts`

### Selector Optimization

For performance, always select the minimal data you need:

```ts
// ❌ Avoid – re-renders on any state change
const state = useStore();

// ✅ Better – only re-renders when subscriptions change
const subscriptions = useStore((s) => s.subscriptions);
const { addSubscription } = useStore((s) => s);

// ✅ Best – use multiple selectors or a shallow comparison
import { shallow } from 'zustand/shallow';
const [subscriptions, stats] = useStore(
  (s) => [s.subscriptions, s.stats],
  shallow
);
```

## Persistence

The combined store uses a single persisted key `subtrackr-root-store-v2` in AsyncStorage. Previous per-store persistence keys are no longer created, but existing stored data is migrated on first load via the `migrate` function in `combinedStore.ts`.

## Rollback

If issues arise, the old individual store files are preserved in the git history. To revert:
```bash
git checkout HEAD~1 -- src/store/
```
