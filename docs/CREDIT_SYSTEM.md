# Credit and account balances

SubTrackr keeps subscriber credit as expiring lots. Credit is consumed
oldest-first, and the available balance never includes expired lots. Every
issuance, application, transfer, and expiry is recorded in the account ledger;
the contract and the mobile Zustand store use the same model.

## Mobile store

```ts
const walletId = useCreditStore.getState().createWallet('subscriber-1', 'sub-1', 'USD');
useCreditStore.getState().deposit('subscriber-1', walletId, 10_000);

const charge = useCreditStore.getState().applyCredit('subscriber-1', 'sub-1', 2_500);
// charge.applied === 2_500 when enough unexpired credit exists

const remaining = useCreditStore.getState().getBalance('subscriber-1');
```

Prepayment wallets are separate from promotional/refund credit and support
`deposit`, `withdraw`, and `drawdown`. Each operation returns the new balance
and a wallet-local transaction ID. Wallet transactions are retained with their
kind, amount, resulting balance, and timestamp. Invalid, unauthorized, or
overdrawn wallet operations return `undefined` in the local store.

## Soroban contract

The `subtrackr-credit` contract exposes the equivalent operations:

```text
create_wallet(subscriber, subscription_id, currency)
deposit(subscriber, wallet_id, amount)
withdraw(subscriber, wallet_id, amount)
drawdown(subscriber, wallet_id, amount)
get_wallet(wallet_id)
```

Credit issuance is admin-authorized. Transfers require the sender's
authorization. Wallet deposits, withdrawals, and drawdowns require the wallet
subscriber's authorization. `expire_credits_with_cron` is admin-only and
enumerates accounts that have been saved by the contract.

Amounts should be represented in the smallest unit of the selected currency,
such as cents for USD. The UI and store use JavaScript numbers, so callers
should keep values within the precise integer range supported by their payment
rail.

## Verification

Run the focused checks from the repository root:

```bash
npm run credit:test:coverage
npm run credit:benchmark
npm run contracts:test -- --package subtrackr-credit
```

The coverage command enforces at least 80% global coverage for the credit
store. The benchmark fails if 100 issue-and-apply workflows exceed 1,500 ms on
the local test runner. This budget includes persisted Zustand state updates.