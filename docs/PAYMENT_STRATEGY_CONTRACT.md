# Crypto Payment Strategy Contract

Reference for `src/services/payment/paymentStrategies.ts`: how a payment
strategy validates input, how a strategy obtains a real transaction hash, and
what the tracker guarantees.

Related: [`BILLING_CYCLE_AND_MONEY.md`](./BILLING_CYCLE_AND_MONEY.md) §4 for the
timeout and gas-bump recovery path that runs after a payment is submitted.

---

## 1. A strategy never invents a transaction hash

`executePayment` used to fabricate a hash and report `success: true`:

```ts
const mockHash = `0x${Math.random().toString(16).substring(2)}…`;
return { success: true, transactionHash: mockHash, … };
```

Nothing was signed, broadcast or confirmed. Any caller that persisted the result
recorded a payment as settled against a hash that does not exist on any chain,
which is unrecoverable once it reaches settlement or reconciliation.

Submission is now injected, and the strategy **fails closed**:

```ts
export type PaymentSubmitter = (params: PaymentParams) => Promise<string>;

const strategy = new EVMPaymentStrategy(async (params) => {
  const tx = await signer.sendTransaction({ … });
  return (await tx.wait()).transactionHash;
});
```

With no submitter wired, `executePayment` returns
`success: false` with `failure.code === PaymentStrategyErrorCode.NO_SUBMITTER`.
Register the real implementation through `PaymentStrategyFactory.registerStrategy`
before using a strategy in a payment path.

---

## 2. Failure codes

`PaymentResult.failure` carries a machine-readable code so callers branch on the
cause instead of matching on message text.

| Code                | Meaning                                              |
| ------------------- | ---------------------------------------------------- |
| `INVALID_RECIPIENT` | Recipient failed address validation; nothing sent.   |
| `INVALID_AMOUNT`    | Amount was blank, non-numeric, zero or negative.     |
| `NO_SUBMITTER`      | No submitter wired — nothing was sent.               |
| `SUBMISSION_FAILED` | The submitter threw; `failure.cause` holds the error. |
| `NO_TX_HASH`        | Submitter resolved but returned no hash.             |

---

## 3. Input validation

### 3.1 EVM recipients

```ts
/^0x[a-fA-F0-9]{40}$/
```

Length and alphabet only — checksum validation belongs at the signer.

### 3.2 Stellar recipients

Stellar account ids are **StrKey** strings: base32, no padding, a leading
version byte, and a trailing CRC. Checking `startsWith('G') && length === 56`
is necessary but not sufficient — it accepts strings that are not base32 and
strings whose leading bits decode to the wrong version byte, so a malformed key
reached submission before being rejected by the network.

Validation therefore decodes the first base32 group and requires the ed25519
version byte:

```ts
const STRKEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STRKEY_ED25519_VERSION_BYTE = 6 << 3; // 48
```

`0`, `1`, `8` and `9` are **not** in the StrKey alphabet. `G` + 55 × `A` is a
valid-shaped key; `G` + `I` + 54 × `A` is the same shape with a wrong version
byte and is rejected.

### 3.3 Amounts

An amount must be a positive decimal — `/^\d*\.?\d+$/` and `> 0`. `''`, `'   '`,
`'abc'`, `'0'`, `'-1'`, `'1.2.3'`, `'NaN'` and `'Infinity'` are all rejected
before the submitter is called. A zero or unparseable amount used to produce a
"successful" payment worth nothing.

---

## 4. UnifiedPaymentTracker

`UnifiedPaymentTracker` keeps the most recent **100** results in a ring buffer.
An unbounded array meant a long session grew without limit and a memory issue
was reachable from ordinary use.

- `getHistory()` returns a defensive copy, oldest first.
- `getSucceeded()` / `getFailed()` filter by outcome for reconciliation views.
- `clearHistory()` empties it; call it in test setup, since the state is static
  and shared across a suite.