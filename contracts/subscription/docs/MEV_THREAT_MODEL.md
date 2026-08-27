# MEV Threat Model for SubTrackr Subscription Charges

## Overview

Maximal Extractable Value (MEV) in the context of Soroban subscription
charges refers to the ability of validators, sequencers, or bots to
reorder, include, or front-run charge transactions to extract value from
subscribers.  This document catalogues the threats and describes the
protections implemented.

## Threat Categories

### 1. Front-running

| Threat | Description | Severity |
|--------|-------------|----------|
| **Price Oracle Front-run** | An adversary observes a pending charge tx and submits their own tx with a manipulated oracle price before the charge is confirmed, causing the subscriber to overpay. | High |
| **Insertion Front-run** | Validator inserts their own transfer before the subscriber's charge, draining the subscriber's token balance and causing the charge to fail (DoS). | Medium |

**Mitigations:**

- **Commit-Reveal** (`commit_charge` / `reveal_charge`): The subscriber
  commits to a SHA-256 hash of (amount, nonce) before the actual charge
  is executed.  The price is hidden until `reveal_charge`, preventing
  front-runners from knowing the charge amount.
- **Oracle Slippage Protection** (`PriceBounds` / `resolve_charge_price`):
  The resolved charge price is clamped to `[min_price_bps, max_price_bps]`
  of the plan price, limiting the impact of oracle manipulation.
- **Per-call `max_gas_fee`**: The subscriber sets a maximum acceptable
  base fee per call; if the ledger base fee exceeds this threshold at
  execution time, the charge is rejected.

### 2. Sandwich Attacks

| Threat | Description | Severity |
|--------|-------------|----------|
| **Oracle Sandwich** | Adversary manipulates the oracle price feed before and after the subscriber's charge, profiting from the price difference. | Medium |

**Mitigations:**

- `resolve_charge_price` uses the oracle's `get_price_with_cache` (TTL
  = 600 ledgers) which returns a cached price rather than a live feed,
  reducing the window for oracle sandwich attacks.
- Slippage bounds (`PriceBounds`) cap the maximum deviation from the
  plan's base price.

### 3. Time-bandit / Reorg Attacks

| Threat | Description | Severity |
|--------|-------------|----------|
| **Ledger Reorg** | A validator rewinds the ledger state to re-execute a charge at a more favourable price, or to double-spend a commitment. | Low |

**Mitigations:**

- Commitments include a `deadline` timestamp.  If the ledger timestamp
  regresses past the deadline, `reveal_charge` rejects the reveal.
- Commitments are single-use: `reveal_charge` removes the commitment
  from storage after successful execution, preventing replay.

### 4. Gas Price Manipulation

| Threat | Description | Severity |
|--------|-------------|----------|
| **Gas Price Spiking** | Validator raises the base fee to force subscribers into paying more gas than expected, or to extract rent from urgent charges. | Medium |
| **Gas Griefing** | Adversary causes the charge transaction to consume more gas (e.g. by bloating storage reads) so the subscriber exceeds their gas budget. | Low |

**Mitigations:**

- **Per-subscription `MevChargeConfig.max_gas`**: Subscribers can set a
  hard cap on total gas per charge.  If the actual gas used exceeds this
  cap, the transaction panics (and any partial state is rolled back).
- **`GasPriceSnapshot`**: After each charge, a snapshot of (ledger_seq,
  base_fee, gas_used, amount_charged) is stored.  Off-chain monitoring
  can detect abnormal gas price patterns.
- **Per-call `max_gas_fee`**: Inline parameter on `charge_subscription`
  allows the caller to reject charges when the base fee is too high.

### 5. Private Mempool / Censorship

| Threat | Description | Severity |
|--------|-------------|----------|
| **Tx Censorship** | A validator censors the subscriber's reveal transaction, letting the commitment expire, then submits their own reveal with a manipulated price. | Medium |
| **Forced Failure** | Validator delays charge transactions to cause `next_charge_at` violations, then collects late fees or penalties. | Low |

**Mitigations:**

- **Private Mempool Config** (`MevChargeConfig.use_private_mempool`):
  When enabled, the contract emits a
  `MevEventKind::PrivateMempoolSubmitted` event.  Off-chain indexers
  forward the event to a private mempool (e.g. via a relayer) to bypass
  public tx visibility.
- `deadline` on commitments is set by the subscriber.  A sufficiently
  long deadline (e.g. several ledger closes) gives the subscriber
  ample time to retry the reveal if censored.

## Architecture Diagram

```
Subscriber                          Contract                        Storage
    |                                 |                               |
    |-- commit_charge(hash, fee, dl)-->|                               |
    |                                 |--- persist ChargeCommitment -->|
    |                                 |--- emit MevEvent::Committed -->|
    |                                 |                               |
    |   ... time passes ...           |                               |
    |                                 |                               |
    |-- reveal_charge(amount, nonce)->|                               |
    |                                 |--- load ChargeCommitment ---->|
    |                                 |--- verify sha256 match -------|
    |                                 |--- check base_fee <= max_fee -|
    |                                 |--- token.transfer() --------->|
    |                                 |--- persist GasPriceSnapshot ->|
    |                                 |--- emit MevEvent::Revealed -->|
```

## Configuration Reference

| Parameter | Type | Scope | Description |
|-----------|------|-------|-------------|
| `use_private_mempool` | `bool` | Per-sub | Emit event for private mempool relay |
| `max_gas_fee` (config) | `i128` | Per-sub | Base fee ceiling from persistent config |
| `max_gas_fee` (per-call) | `Option<i128>` | Per-charge | Inline base fee ceiling (overrides config) |
| `max_gas` | `Option<u64>` | Per-charge | Gas budget ceiling |
| `commitment_hash` | `Bytes` | Per-charge | SHA-256(amount \|\| nonce \|\| subscriber) |
| `deadline` | `u64` | Per-charge | Timestamp after which commitment expires |

## Error Codes

| Code | Error | Condition |
|------|-------|-----------|
| 22 | `SlippageExceeded` | Base fee exceeds `max_gas_fee` |
| 23 | `CommitmentExpired` | `now > deadline` on reveal or `deadline < now` on commit |
| 24 | `CommitmentMismatch` | SHA-256(amount, nonce, subscriber) does not match stored hash |
| 25 | `MaxGasExceeded` | Actual gas used exceeds `max_gas` |
| 26 | `PrivateMempoolRequired` | Charge attempted without private mempool when config requires it |

## Monitoring & Alerting

Off-chain indexers should watch for the following events:

| Event Topic | Action |
|-------------|--------|
| `mev_event` + `GasPriceAnomaly` | Alert: gas price spike detected for subscriber |
| `mev_event` + `PrivateMempoolSubmitted` | Verify that the tx was routed through private mempool |
| `mev_event` + `Expired` | Alert: commitment expired without reveal (possible censorship) |
| `rate_limit_violation` (on `charge_subscription`) | Check for DoS attempts on the subscriber |

Compare `GasPriceSnapshot.base_fee` across consecutive charges for the
same subscription.  A sudden increase > 2x may indicate a gas price
attack and should trigger a manual review.
