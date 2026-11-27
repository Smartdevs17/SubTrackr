//! On-chain cancellation proofs anchored by a Soroban event (#2027).
//!
//! When a subscriber cancels, the contract derives a deterministic SHA-256
//! digest over the facts of the cancellation and
//!   1. stores the proof under the subscription ID, and
//!   2. emits a `cancel_proof` event carrying the same digest.
//!
//! The event anchors the proof in the ledger history, so a subscriber can
//! show a merchant or a dispute process that the cancellation happened at a
//! given time and ledger, without trusting an off-chain log. Anyone holding
//! the claimed facts can recompute the digest with [`compute_digest`] or call
//! `verify_cancellation_proof` on the contract.
//!
//! Digest preimage (all integers big-endian):
//!   "subtrackr:cancel:v1" || subscription_id(8) || plan_id(8) ||
//!   cancelled_at(8) || ledger_sequence(4) || subscriber XDR

use soroban_sdk::{contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, String};

const DOMAIN_TAG: &[u8] = b"subtrackr:cancel:v1";

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CancellationProof {
    pub subscription_id: u64,
    pub plan_id: u64,
    pub subscriber: Address,
    /// Ledger timestamp (seconds) at cancellation.
    pub cancelled_at: u64,
    /// Ledger sequence at cancellation.
    pub ledger_sequence: u32,
    /// SHA-256 digest of the preimage described in the module docs.
    pub digest: BytesN<32>,
}

/// Recompute the digest for the given cancellation facts.
pub fn compute_digest(
    env: &Env,
    subscription_id: u64,
    plan_id: u64,
    subscriber: &Address,
    cancelled_at: u64,
    ledger_sequence: u32,
) -> BytesN<32> {
    let mut preimage = Bytes::from_slice(env, DOMAIN_TAG);
    preimage.append(&Bytes::from_array(env, &subscription_id.to_be_bytes()));
    preimage.append(&Bytes::from_array(env, &plan_id.to_be_bytes()));
    preimage.append(&Bytes::from_array(env, &cancelled_at.to_be_bytes()));
    preimage.append(&Bytes::from_array(env, &ledger_sequence.to_be_bytes()));
    preimage.append(&subscriber.clone().to_xdr(env));
    env.crypto().sha256(&preimage).into()
}

/// Build the proof for a cancellation happening in the current ledger, store
/// it and emit the anchoring event. A later cancellation of the same
/// subscription (after reactivation) replaces the stored proof; the earlier
/// one stays anchored in its event.
pub fn record(
    env: &Env,
    subscription_id: u64,
    plan_id: u64,
    subscriber: &Address,
) -> CancellationProof {
    let cancelled_at = env.ledger().timestamp();
    let ledger_sequence = env.ledger().sequence();
    let digest = compute_digest(
        env,
        subscription_id,
        plan_id,
        subscriber,
        cancelled_at,
        ledger_sequence,
    );
    let proof = CancellationProof {
        subscription_id,
        plan_id,
        subscriber: subscriber.clone(),
        cancelled_at,
        ledger_sequence,
        digest: digest.clone(),
    };
    crate::feature_set(
        env,
        crate::FeatureStoreKey::CancellationProof(subscription_id),
        proof.clone(),
    );
    env.events().publish(
        (String::from_str(env, "cancel_proof"), subscriber.clone()),
        (subscription_id, digest, cancelled_at, ledger_sequence),
    );
    proof
}

pub fn get(env: &Env, subscription_id: u64) -> Option<CancellationProof> {
    crate::feature_get(
        env,
        crate::FeatureStoreKey::CancellationProof(subscription_id),
    )
}

/// True when the stored proof for `subscription_id` carries `digest` and the
/// digest still matches a fresh computation from the stored facts.
pub fn verify(env: &Env, subscription_id: u64, digest: &BytesN<32>) -> bool {
    match get(env, subscription_id) {
        Some(p) => {
            let fresh = compute_digest(
                env,
                p.subscription_id,
                p.plan_id,
                &p.subscriber,
                p.cancelled_at,
                p.ledger_sequence,
            );
            p.digest == fresh && &p.digest == digest
        }
        None => false,
    }
}
