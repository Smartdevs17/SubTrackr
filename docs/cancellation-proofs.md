# Cancellation proofs

`contracts/subscription/src/cancellation.rs` (#2027) anchors every cancellation in a Soroban event.

On `cancel_subscription` the contract computes `SHA-256("subtrackr:cancel:v1" || subscription_id || plan_id || cancelled_at || ledger_sequence || subscriber XDR)`, with integers big-endian. It stores a `CancellationProof` under the subscription ID and publishes:

- topics: `("cancel_proof", subscriber)`
- data: `(subscription_id, digest, cancelled_at, ledger_sequence)`

Read it back with `get_cancellation_proof(proxy, storage, subscription_id)`. Check a claimed digest with `verify_cancellation_proof(proxy, storage, subscription_id, digest)`, which also recomputes the digest from the stored facts. A third party with the facts can recompute the digest and match it against the event in ledger history.

If a subscription is reactivated and cancelled again, the stored proof is replaced. The earlier proof stays anchored in its event.

The issue named `contracts/src/cancel.rs`. That directory is not part of the Cargo workspace, so the code lives in the subscription crate's existing `cancellation.rs`, which was an uncompiled placeholder.

Tests: `contracts/subscription/tests/cancellation_proof.rs`.
