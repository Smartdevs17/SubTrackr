# SubTrackr API Reference

SubTrackr exposes its backend logic through a **Soroban smart contract** on the Stellar network and **client-side service layers** in TypeScript. This document covers every public function, data structure, and error code.

## Table of Contents

- [Smart Contract API](#smart-contract-api)
  - [Data Types](#data-types)
  - [Initialization](#initialization)
  - [Plan Management](#plan-management)
  - [Subscription Management](#subscription-management)
  - [Payment Processing](#payment-processing)
  - [Queries](#queries)
  - [Events](#events)
  - [Error Codes](#error-codes)
- [Wallet Service API](#wallet-service-api)
  - [Connection Management](#connection-management)
  - [Token Balances](#token-balances)
  - [Gas Estimation](#gas-estimation)
  - [Stream Creation](#stream-creation)
  - [Wallet Error Codes](#wallet-error-codes)
- [Notification Service API](#notification-service-api)
- [Data Types Reference](#data-types-reference)
  - [API Types](#api-types)
  - [Subscription Types](#subscription-types)
  - [Wallet Types](#wallet-types)
- [Supported Chains](#supported-chains)
- [Contract Addresses](#contract-addresses)

---

## Smart Contract API

The Soroban smart contract (`contracts/src/lib.rs`) handles subscription plan creation, subscriber lifecycle management, billing, and refunds. All functions are invoked via Soroban RPC.

### Data Types

#### Interval

Defines billing frequency for subscription plans.

| Variant     | Duration    |
| ----------- | ----------- |
| `Weekly`    | 604,800s    |
| `Monthly`   | 2,592,000s  |
| `Quarterly` | 7,776,000s  |
| `Yearly`    | 31,536,000s |

#### SubscriptionStatus

| Variant     | Description                         |
| ----------- | ----------------------------------- |
| `Active`    | Subscription is active and billable |
| `Paused`    | Temporarily paused by subscriber    |
| `Cancelled` | Permanently cancelled               |
| `PastDue`   | Payment failed or overdue           |

#### Plan

```rust
{
  id: u64,
  merchant: Address,
  name: String,
  price: i128,           // in stroops (XLM smallest unit)
  token: Address,
  interval: Interval,
  active: bool,
  subscriber_count: u32,
  created_at: u64,       // Unix timestamp
}
```

#### Subscription

```rust
{
  id: u64,
  plan_id: u64,
  subscriber: Address,
  status: SubscriptionStatus,
  started_at: u64,           // Unix timestamp
  last_charged_at: u64,      // Unix timestamp
  next_charge_at: u64,       // Unix timestamp
  total_paid: i128,          // cumulative amount paid in stroops
  refund_requested_amount: i128,
}
```

---

### Initialization

#### `initialize`

Set the contract admin. Must be called once before any other function.

**Parameters:**

| Name    | Type      | Description          |
| ------- | --------- | -------------------- |
| `admin` | `Address` | Admin wallet address |

**Auth:** None (first-time setup only).

**Example:**

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- initialize \
  --admin GABCDEF...
```

---

### Plan Management

#### `create_plan`

Create a new subscription plan. Returns the plan ID.

**Parameters:**

| Name       | Type       | Description                    |
| ---------- | ---------- | ------------------------------ |
| `merchant` | `Address`  | Plan owner address             |
| `name`     | `String`   | Plan display name              |
| `price`    | `i128`     | Price per interval in stroops  |
| `token`    | `Address`  | Payment token contract address |
| `interval` | `Interval` | Billing frequency              |

**Auth:** Requires `merchant` authorization.

**Returns:** `u64` - the new plan ID.

**Errors:**

- `"Price must be positive"` - if `price <= 0`

**Example:**

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- create_plan \
  --merchant GABCDEF... \
  --name "Pro Monthly" \
  --price 10000000 \
  --token CTOKEN... \
  --interval Monthly
```

**Response:**

```
1
```

#### `deactivate_plan`

Deactivate a plan so no new subscribers can join. Existing subscribers continue until they cancel.

**Parameters:**

| Name       | Type      | Description              |
| ---------- | --------- | ------------------------ |
| `merchant` | `Address` | Plan owner address       |
| `plan_id`  | `u64`     | ID of plan to deactivate |

**Auth:** Requires `merchant` authorization. Must match plan owner.

**Errors:**

- `"Only plan owner can deactivate"` - if caller is not the plan merchant

---

### Subscription Management

#### `subscribe`

Subscribe to an active plan. Processes the first payment immediately. Returns the subscription ID.

**Parameters:**

| Name         | Type      | Description               |
| ------------ | --------- | ------------------------- |
| `subscriber` | `Address` | Subscriber wallet address |
| `plan_id`    | `u64`     | ID of the plan            |

**Auth:** Requires `subscriber` authorization.

**Returns:** `u64` - the new subscription ID.

**Errors:**

- `"Plan is not active"` - if the plan has been deactivated
- `"Merchant cannot self-subscribe"` - if subscriber is the plan merchant
- `"Already subscribed to this plan"` - if subscriber has an active subscription to this plan

**Example:**

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- subscribe \
  --subscriber GUSER123... \
  --plan_id 1
```

**Response:**

```
1
```

#### `cancel_subscription`

Permanently cancel a subscription. Works on Active or Paused subscriptions.

**Parameters:**

| Name              | Type      | Description               |
| ----------------- | --------- | ------------------------- |
| `subscriber`      | `Address` | Subscriber wallet address |
| `subscription_id` | `u64`     | ID of the subscription    |

**Auth:** Requires `subscriber` authorization.

**Errors:**

- `"Only subscriber can cancel"` - if caller is not the subscriber

#### `pause_subscription`

Temporarily pause billing on a subscription.

**Parameters:**

| Name              | Type      | Description               |
| ----------------- | --------- | ------------------------- |
| `subscriber`      | `Address` | Subscriber wallet address |
| `subscription_id` | `u64`     | ID of the subscription    |

**Auth:** Requires `subscriber` authorization.

**Errors:**

- `"Only active subscriptions can be paused"` - if status is not Active

#### `resume_subscription`

Resume a paused subscription.

**Parameters:**

| Name              | Type      | Description               |
| ----------------- | --------- | ------------------------- |
| `subscriber`      | `Address` | Subscriber wallet address |
| `subscription_id` | `u64`     | ID of the subscription    |

**Auth:** Requires `subscriber` authorization.

**Errors:**

- `"Subscription not active"` - if status is not Paused (note: error message is reused)

---

### Payment Processing

#### `charge_subscription`

Process a due payment for an active subscription. Anyone can call this (permissionless keeper pattern).

**Parameters:**

| Name              | Type  | Description            |
| ----------------- | ----- | ---------------------- |
| `subscription_id` | `u64` | ID of the subscription |

**Errors:**

- `"Subscription not active"` - if status is not Active
- `"Payment not yet due"` - if current time < `next_charge_at`

**Side effects:**

- Transfers `plan.price` from subscriber to merchant via the plan's token contract
- Updates `last_charged_at`, `next_charge_at`, and `total_paid`

#### `request_refund`

Submit a refund request for a subscription.

**Parameters:**

| Name              | Type   | Description             |
| ----------------- | ------ | ----------------------- |
| `subscription_id` | `u64`  | ID of the subscription  |
| `amount`          | `i128` | Requested refund amount |

**Errors:**

- `"Refund amount must be positive"` - if `amount <= 0`
- `"Refund amount cannot exceed total paid"` - if `amount > total_paid`

**Events:**

- `refund_requested(subscription_id, (subscriber, amount))`

#### `approve_refund`

Admin approves a pending refund. Transfers tokens from merchant to subscriber.

**Parameters:**

| Name              | Type  | Description            |
| ----------------- | ----- | ---------------------- |
| `subscription_id` | `u64` | ID of the subscription |

**Auth:** Requires admin authorization.

**Errors:**

- `"No pending refund request"` - if `refund_requested_amount == 0`

**Events:**

- `refund_approved(subscription_id, (subscriber, amount))`

#### `reject_refund`

Admin rejects a pending refund request, resetting the requested amount to zero.

**Parameters:**

| Name              | Type  | Description            |
| ----------------- | ----- | ---------------------- |
| `subscription_id` | `u64` | ID of the subscription |

**Auth:** Requires admin authorization.

**Errors:**

- `"No pending refund request"` - if `refund_requested_amount == 0`

**Events:**

- `refund_rejected(subscription_id, subscriber)`

---

### Queries

All query functions are read-only and require no authorization.

#### `get_plan`

| Parameter | Type  | Returns |
| --------- | ----- | ------- |
| `plan_id` | `u64` | `Plan`  |

#### `get_subscription`

| Parameter         | Type  | Returns        |
| ----------------- | ----- | -------------- |
| `subscription_id` | `u64` | `Subscription` |

#### `get_user_subscriptions`

Returns all subscription IDs for a given subscriber.

| Parameter    | Type      | Returns    |
| ------------ | --------- | ---------- |
| `subscriber` | `Address` | `Vec<u64>` |

#### `get_merchant_plans`

Returns all plan IDs for a given merchant.

| Parameter  | Type      | Returns    |
| ---------- | --------- | ---------- |
| `merchant` | `Address` | `Vec<u64>` |

#### `get_plan_count`

Returns the total number of plans created.

| Returns |
| ------- |
| `u64`   |

#### `get_subscription_count`

Returns the total number of subscriptions created.

| Returns |
| ------- |
| `u64`   |

**Example (query):**

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- get_plan \
  --plan_id 1
```

**Response:**

```json
{
  "id": 1,
  "merchant": "GABCDEF...",
  "name": "Pro Monthly",
  "price": 10000000,
  "token": "CTOKEN...",
  "interval": "Monthly",
  "active": true,
  "subscriber_count": 5,
  "created_at": 1711324800
}
```

---

### Events

The contract emits Soroban events for refund lifecycle actions. Subscribe to these via Soroban RPC event streaming.

| Event              | Topic 1           | Data                                  |
| ------------------ | ----------------- | ------------------------------------- |
| `refund_requested` | `subscription_id` | `(subscriber: Address, amount: i128)` |
| `refund_approved`  | `subscription_id` | `(subscriber: Address, amount: i128)` |
| `refund_rejected`  | `subscription_id` | `subscriber: Address`                 |

---

### Error Codes

All smart contract errors are returned as string panics.

| Error Message                             | Function(s)                                  | Cause                                 |
| ----------------------------------------- | -------------------------------------------- | ------------------------------------- |
| `Price must be positive`                  | `create_plan`                                | Price is zero or negative             |
| `Plan is not active`                      | `subscribe`                                  | Plan was deactivated                  |
| `Merchant cannot self-subscribe`          | `subscribe`                                  | Subscriber address matches merchant   |
| `Already subscribed to this plan`         | `subscribe`                                  | Duplicate active subscription         |
| `Only subscriber can cancel`              | `cancel_subscription`                        | Caller is not the subscriber          |
| `Only active subscriptions can be paused` | `pause_subscription`                         | Subscription is not Active            |
| `Subscription not active`                 | `resume_subscription`, `charge_subscription` | Subscription is not in expected state |
| `Payment not yet due`                     | `charge_subscription`                        | Current time < next_charge_at         |
| `Refund amount must be positive`          | `request_refund`                             | Amount is zero or negative            |
| `Refund amount cannot exceed total paid`  | `request_refund`                             | Amount > total_paid                   |
| `No pending refund request`               | `approve_refund`, `reject_refund`            | No refund was requested               |
| `Only plan owner can deactivate`          | `deactivate_plan`                            | Caller is not the plan merchant       |

---

## Wallet Service API

The wallet service (`src/services/walletService.ts`) is a singleton (`WalletServiceManager`) that manages EVM wallet connections, token balances, and streaming payment creation via Superfluid and Sablier.

### Connection Management

#### `getInstance(): WalletServiceManager`

Returns the singleton wallet service instance.

#### `initialize(): Promise<void>`

Initialize the service. Call once at app startup.

#### `setConnection(connection: WalletConnection | null): void`

Set or clear the active wallet connection.

**WalletConnection:**

```typescript
{
  address: string;      // EVM wallet address (0x...)
  chainId: number;      // Chain ID (1, 137, 42161)
  isConnected: boolean;
  provider?: Web3Provider;
  eip1193Provider?: ExternalProvider;
}
```

#### `getConnection(): WalletConnection | null`

Returns the current wallet connection or null.

#### `isConnected(): boolean`

Returns `true` if a wallet is connected.

#### `disconnectWallet(): Promise<void>`

Disconnect the current wallet and notify listeners.

#### `addListener(listener: (connection: WalletConnection | null) => void): void`

Subscribe to connection state changes.

#### `removeListener(listener: (connection: WalletConnection | null) => void): void`

Unsubscribe from connection state changes.

---

### Token Balances

#### `getTokenBalances(address: string, chainId: number): Promise<TokenBalance[]>`

Fetch native currency and USDC balances for a wallet.

**Parameters:**

| Name      | Type     | Description              |
| --------- | -------- | ------------------------ |
| `address` | `string` | Wallet address           |
| `chainId` | `number` | Chain ID (1, 137, 42161) |

**Returns:** Array of `TokenBalance`:

```typescript
{
  symbol: string;     // e.g. "ETH", "USDC"
  name: string;       // e.g. "Ethereum", "USD Coin"
  address: string;    // Token contract address ("native" for ETH)
  balance: string;    // Formatted balance
  decimals: number;   // Token decimals
  logoURI?: string;
}
```

**Example response:**

```json
[
  {
    "symbol": "ETH",
    "name": "Ethereum",
    "address": "native",
    "balance": "1.5432",
    "decimals": 18
  },
  {
    "symbol": "USDC",
    "name": "USD Coin",
    "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "balance": "250.00",
    "decimals": 6
  }
]
```

---

### Gas Estimation

#### `estimateGas(from, to, value, chainId): Promise<GasEstimate>`

Estimate gas for a simple token transfer.

**Parameters:**

| Name      | Type     | Description       |
| --------- | -------- | ----------------- |
| `from`    | `string` | Sender address    |
| `to`      | `string` | Recipient address |
| `value`   | `string` | Transfer value    |
| `chainId` | `number` | Chain ID          |

#### `estimateSuperfluidCreateFlow(tokenSymbol, amountPerMonth, recipient, chainId): Promise<GasEstimate>`

Estimate gas for creating a Superfluid stream.

**Parameters:**

| Name             | Type     | Description                |
| ---------------- | -------- | -------------------------- |
| `tokenSymbol`    | `string` | Token symbol (e.g. "USDC") |
| `amountPerMonth` | `string` | Monthly amount to stream   |
| `recipient`      | `string` | Recipient address          |
| `chainId`        | `number` | Chain ID                   |

**GasEstimate:**

```typescript
{
  gasLimit: string; // Estimated gas units
  gasPrice: string; // Gas price in wei
  estimatedCost: string; // Total cost formatted in native currency
}
```

---

### Stream Creation

#### `createSuperfluidStream(tokenSymbol, amountPerMonth, recipient, chainId): Promise<SuperfluidStreamResult>`

Create a continuous payment stream using Superfluid's Constant Flow Agreement (CFA).

**Parameters:**

| Name             | Type     | Description                |
| ---------------- | -------- | -------------------------- |
| `tokenSymbol`    | `string` | Token symbol (e.g. "USDC") |
| `amountPerMonth` | `string` | Monthly amount to stream   |
| `recipient`      | `string` | Recipient address          |
| `chainId`        | `number` | Chain ID                   |

**Returns:**

```typescript
{
  txHash: string; // Transaction hash
  streamId: string; // Superfluid stream identifier
}
```

**Flow rate calculation:** `amountPerMonth / SECONDS_PER_MONTH` (where SECONDS_PER_MONTH = 2,592,000).

#### `createSablierStream(token, amount, startTime, stopTime, recipient, chainId): Promise<string>`

Create a time-locked vesting stream using Sablier V2.

**Parameters:**

| Name        | Type     | Description                     |
| ----------- | -------- | ------------------------------- |
| `token`     | `string` | Token contract address          |
| `amount`    | `string` | Total amount to stream          |
| `startTime` | `number` | Unix timestamp for stream start |
| `stopTime`  | `number` | Unix timestamp for stream end   |
| `recipient` | `string` | Recipient address               |
| `chainId`   | `number` | Chain ID                        |

**Returns:** `string` - transaction hash.

**Sablier V2 contract:** `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`

---

### Wallet Error Codes

| Error Message                                                                         | Cause                                                    |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `Wallet is not connected or does not expose a signing provider`                       | No active wallet connection with a signer                |
| `Wallet network (X) does not match selected chain (Y). Switch network in your wallet` | Chain ID mismatch between wallet and requested operation |
| `Monthly amount is too small to stream (flow rate rounds to zero per second)`         | Superfluid flow rate would be 0                          |
| `Recipient must be a different address than your connected wallet`                    | Self-stream attempt                                      |
| `No RPC configured for chain X`                                                       | Unsupported chain ID                                     |
| `ARB is not supported as a Superfluid super token on this flow`                       | Unsupported super token                                  |
| `Transaction was rejected in your wallet`                                             | User rejected the wallet prompt                          |
| `Could not estimate gas for Superfluid createFlow`                                    | Gas estimation failure                                   |

---

## Notification Service API

The notification service (`src/services/notificationService.ts`) manages push notifications for billing reminders and charge outcomes.

### Functions

#### `configureNotificationHandler(): void`

Configure the Expo notification handler. Call once at app startup.

#### `ensureAndroidNotificationChannel(): Promise<void>`

Set up the Android notification channel for billing alerts.

#### `getPermissionStatus(): Promise<PermissionStatus>`

Get the current notification permission status.

#### `requestNotificationPermissions(): Promise<PermissionStatus>`

Request notification permissions from the user.

#### `syncRenewalReminders(subscriptions: Subscription[]): Promise<void>`

Cancel all existing reminders and reschedule based on current subscriptions. Only schedules reminders for subscriptions where `isActive === true` and `notificationsEnabled !== false`.

**Reminder timing:**

- 1 day before `nextBillingDate` if there is enough lead time
- Otherwise, 1 hour before `nextBillingDate`

#### `presentChargeSuccessNotification(sub: Subscription): Promise<void>`

Display an immediate notification for a successful charge.

**Notification content:**

- Title: `"Payment successful"`
- Body: `"Your {name} subscription has been renewed."`

#### `presentChargeFailedNotification(sub: Subscription, detail?: string): Promise<void>`

Display an immediate notification for a failed charge.

**Notification content:**

- Title: `"Payment failed"`
- Body: `"Could not renew {name}. {detail}"` or `"Could not renew {name}. Check your balance."`

#### `navigateToSubscriptionFromNotification(subscriptionId: string): void`

Navigate to the subscription detail screen when a notification is tapped.

#### `attachNotificationResponseListeners(): () => void`

Attach listeners for notification taps. Returns a cleanup function.

### Notification Data Types

| Type               | Value              | Description            |
| ------------------ | ------------------ | ---------------------- |
| `RENEWAL_REMINDER` | `renewal_reminder` | Upcoming billing alert |
| `CHARGE_SUCCESS`   | `charge_success`   | Payment succeeded      |
| `CHARGE_FAILED`    | `charge_failed`    | Payment failed         |

---

## Data Types Reference

### API Types

Defined in `src/types/api.ts`.

#### `ApiResponse<T>`

```typescript
{
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
```

#### `PaginatedResponse<T>`

```typescript
{
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}
```

#### `UserProfile`

```typescript
{
  id: string;
  email: string;
  name: string;
  avatar?: string;
  preferences: NotificationPreferences;
  createdAt: Date;
  updatedAt: Date;
}
```

#### `NotificationPreferences`

```typescript
{
  pushEnabled: boolean;
  emailEnabled: boolean;
  billingReminders: boolean;
  cryptoUpdates: boolean;
  spendingAlerts: boolean;
}
```

#### `AppSettings`

```typescript
{
  theme: 'light' | 'dark' | 'system';
  currency: string;
  language: string;
  notifications: NotificationPreferences;
  privacy: {
    dataSharing: boolean;
    analytics: boolean;
  }
}
```

#### `ErrorState`

```typescript
{
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}
```

---

### Subscription Types

Defined in `src/types/subscription.ts`.

#### `Subscription`

```typescript
{
  id: string;
  name: string;
  description?: string;
  category: SubscriptionCategory;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  nextBillingDate: Date;
  isActive: boolean;
  notificationsEnabled?: boolean;
  isCryptoEnabled: boolean;
  cryptoStreamId?: string;
  cryptoToken?: string;
  cryptoAmount?: number;
  createdAt: Date;
  updatedAt: Date;
}
```

#### `SubscriptionCategory`

| Value          | Description        |
| -------------- | ------------------ |
| `streaming`    | Streaming services |
| `software`     | Software tools     |
| `gaming`       | Gaming services    |
| `productivity` | Productivity apps  |
| `fitness`      | Fitness and health |
| `education`    | Learning platforms |
| `finance`      | Financial services |
| `other`        | Uncategorized      |

#### `BillingCycle`

| Value     | Description     |
| --------- | --------------- |
| `monthly` | Billed monthly  |
| `yearly`  | Billed annually |
| `weekly`  | Billed weekly   |
| `custom`  | Custom interval |

#### `SubscriptionFormData`

```typescript
{
  name: string;
  description?: string;
  category: SubscriptionCategory;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  nextBillingDate: Date;
  notificationsEnabled?: boolean;
  isCryptoEnabled: boolean;
  cryptoToken?: string;
  cryptoAmount?: number;
}
```

#### `SubscriptionStats`

```typescript
{
  totalActive: number;
  totalMonthlySpend: number;
  totalYearlySpend: number;
  categoryBreakdown: Record<SubscriptionCategory, number>;
}
```

---

### Wallet Types

Defined in `src/types/wallet.ts`.

#### `Wallet`

```typescript
{
  address: string;
  chainId: number;
  isConnected: boolean;
  balance: string;
  tokens: TokenBalance[];
}
```

#### `CryptoStream`

```typescript
{
  id: string;
  subscriptionId: string;
  token: string;
  amount: number;
  flowRate: string;
  startDate: Date;
  endDate?: Date;
  isActive: boolean;
  protocol: 'superfluid' | 'sablier';
  streamId?: string;
}
```

#### `Transaction`

```typescript
{
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: Date;
}
```

#### `ChainInfo`

```typescript
{
  id: SupportedChains;
  name: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  }
}
```

---

## Supported Chains

| Chain    | Chain ID | RPC URL                        |
| -------- | -------- | ------------------------------ |
| Ethereum | 1        | `https://cloudflare-eth.com`   |
| Polygon  | 137      | `https://polygon-rpc.com`      |
| Arbitrum | 42161    | `https://arb1.arbitrum.io/rpc` |

Additional chains defined in wallet types but not yet configured with RPC:

| Chain    | Chain ID |
| -------- | -------- |
| Optimism | 10       |
| Base     | 8453     |

---

## Contract Addresses

### USDC Addresses by Chain

| Chain    | Address                                      |
| -------- | -------------------------------------------- |
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Polygon  | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| Arbitrum | `0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8` |

### Protocol Addresses

| Protocol   | Address                                      |
| ---------- | -------------------------------------------- |
| Sablier V2 | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` |

### Soroban Contract

Set via `CONTRACT_ID` environment variable. Deploy with:

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/subtrackr.wasm \
  --network testnet
```

---

## Versioning

This API documentation corresponds to the current `main` branch. The Soroban contract does not use semantic versioning on-chain; breaking changes require redeployment to a new contract ID. Client-side services follow the app version in `package.json`.
