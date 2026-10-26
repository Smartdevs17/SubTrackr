# Multi-Chain Subscriptions and Unified Billing

A payer's subscriptions do not all live on one chain: one is funded from USDC on
Polygon, another settles in XLM on Stellar. Left alone that produces one bill per
chain, each denominated in its own asset — which is not a bill anyone can read.

`src/services/multiChainSubscriptionService.ts` keeps the chain binding of every
subscription and answers the two questions the rest of the app needs.

## Chain bindings

Each subscription carries a `ChainBinding`: chain type, chain id, network id,
the token it is denominated in, and the wallet that funds it.

```ts
multiChainSubscriptionService.register({
  subscriptionId: 'sub_1',
  subscriberId: 'payer_1',
  name: 'Pro Plan',
  amount: 10,                       // denominated in binding.tokenSymbol
  binding: {
    chainType: ChainType.EVM,
    chainId: 137,
    networkId: 'polygon',
    tokenSymbol: 'USDC',
    walletAddress: '0x…',
  },
  nextBillingDate: new Date('2026-02-01'),
  isActive: true,
});
```

`rebind()` moves a subscription to another chain when a payer switches funding
wallets. The billed amount does not change; only where it settles does.

## Unified billing

`buildUnifiedStatement()` converts every chain's charges into one currency:

```ts
const statement = multiChainSubscriptionService.buildUnifiedStatement('payer_1', {
  currency: 'USD',
  rates: [
    { tokenSymbol: 'USDC', rate: 1,    asOf: new Date() },
    { tokenSymbol: 'XLM',  rate: 0.25, asOf: new Date() },
  ],
  dueBefore: endOfMonth,
});
```

The statement carries three views of the same charges:

- `lines` — one per subscription, with the rate applied and both amounts.
- `chainSubtotals` — per chain, keeping **native token totals** alongside the
  converted total. Native amounts are what a payer checks against their wallet;
  the converted figure is what they owe.
- `total` — one number, in `currency`.

### Unpriced subscriptions

A subscription whose token has no rate is listed in `unpricedSubscriptionIds`
and **excluded** from `total` — never silently treated as zero. A bill that
quietly under-reports is worse than one that says what it could not price. The
chain subtotal still shows the native amount, so nothing disappears from view.

A token already denominated in the statement currency needs no rate.

Rates are **injected**, not fetched here, so aggregation stays deterministic and
testable; production wires in `oraclePriceService`.

## Settlement planning

`planSettlement()` decides how each due charge actually pays:

| Action | When |
|---|---|
| `direct` | The subscription's own chain is healthy. |
| `bridge` | That chain is down, but another chain the payer already uses holds enough of the same token. |
| `blocked` | That chain is down and no funded alternative exists. |

```ts
const plan = multiChainSubscriptionService.planSettlement('payer_1', {
  health: [{ networkId: 'polygon', healthy: false }],
  balances: { 'arbitrum::USDC': 100 },   // see balanceKey()
});
```

Three rules keep a plan honest:

1. Fallback candidates are only chains the payer **already uses** — a plan never
   invents a chain they have no wallet on.
2. The fallback must hold enough of the **same token**; USDC on Arbitrum cannot
   cover an XLM charge.
3. The fallback must itself be healthy.

When none holds, the step is `blocked` with a reason rather than dropped.
Silently skipping an unpayable charge is how subscriptions lapse without anyone
noticing.

Chains absent from the `health` list are assumed healthy, so a caller can pass
only the failures it knows about.

Once a plan has `bridge` steps, `crossChainRoutingService.findPaymentRoute()`
turns each one into an actual bridge route.

## Cross-chain balances

`WalletServiceManager.getBalancesAcrossChains()` fetches balances from several
chains at once for the unified view:

```ts
const balances = await walletServiceManager.getBalancesAcrossChains('0x…', [1, 137, 42161]);
balances.failedChainIds;   // chains that could not be read
WalletServiceManager.totalsBySymbol(balances, 'USDC');   // { 137: 50, 42161: 25 }
```

Two deliberate choices:

- **Failures are per chain, not fatal.** One unreachable RPC must not blank the
  whole balances screen, so errors are reported alongside the chains that did
  respond.
- **`totalsBySymbol` returns a per-chain map, not a sum.** The same symbol on two
  chains is not fungible; a single figure would imply it is, and a payer would
  think a charge is covered when the funds sit on the wrong chain.

Requests run in parallel — a serial walk over a handful of RPCs is the slowest
thing on that screen.

## Payment Strategy Pattern

Wallet payment operations are dispatched through
`WalletChainStrategyRegistry` in `src/services/walletService.ts`. Each strategy
owns chain-specific behavior: balance lookup, gas estimation, wallet switching,
and connection setup.

```ts
import {
  WalletChainStrategyRegistry,
  EvmWalletChainStrategy,
  StellarWalletChainStrategy,
} from '../src/services/walletService';

const registry = new WalletChainStrategyRegistry([
  new EvmWalletChainStrategy(),
  new StellarWalletChainStrategy(),
]);

const strategy = registry.getStrategyForChain(137);
```

The app service keeps its existing public API:

```ts
await walletServiceManager.switchChain(ChainType.EVM, 137);
const balances = await walletServiceManager.getBalancesAcrossChains('0x...', [1, 137, 42161]);
```

Server-side gateway routing uses
`MultiChainPaymentRoutingStrategy` in `backend/services/payment/domain/PaymentRouter.ts`.
Merchant configs still work, but chain-specific overrides can take priority for
Stellar or EVM settlement:

```ts
paymentRouter.setMerchantConfig('merchant_1', {
  primary: 'stripe',
  secondary: 'circle',
  chainOverrides: {
    stellar: ['stellar', 'circle'],
    evm: ['circle', 'stripe'],
  },
});
```

Contract deployments do not need a router change when a new chain strategy is
added. The app should add the deployed network IDs to the environment profile
and register the corresponding strategy.

## Testing

- `src/services/__tests__/multiChainSubscriptionService.test.ts`
- `src/services/__tests__/walletMultiChain.test.ts`
- `src/services/__tests__/walletChainStrategies.test.ts`
- `backend/services/payment/__tests__/PaymentRouter.test.ts`

`MultiChainSubscriptionService` is a singleton; call `reset()` in `beforeEach`.
