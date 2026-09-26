use soroban_sdk::{contracttype, Env, String, Vec};
use subtrackr_types::ChargeStatus;

// ── Timeout config defaults ───────────────────────────────────────────────────

/// Default per-chain timeout windows (seconds). Soroban Stellar: 30 s ledger
/// finality makes 300 s (5 min) a safe base; EVM-like chains warrant longer.
pub const DEFAULT_TIMEOUT_SECS: u64 = 300; // 5 min
pub const MAX_TIMEOUT_SECS: u64 = 3_600; // 1 h absolute cap
pub const DEFAULT_GAS_BUMP_BPS: u32 = 1_500; // +15 % on retry
pub const MAX_RECOVERY_ATTEMPTS: u32 = 5;

// ── On-chain types ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TimeoutStatus {
    /// Transaction submitted; waiting for confirmation.
    Pending,
    /// Timeout window exceeded; recovery pending.
    TimedOut,
    /// Recovery retry in flight.
    Recovering,
    /// Recovery succeeded — transaction confirmed.
    Resolved,
    /// All recovery attempts exhausted.
    Abandoned,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ChainTimeoutConfig {
    /// Chain identifier (e.g. Stellar mainnet = 1, testnet = 2, …).
    pub chain_id: u64,
    /// Seconds before a pending tx is considered timed out.
    pub timeout_secs: u64,
    /// Basis points to bump gas on each recovery attempt (+1 500 bps = +15 %).
    pub gas_bump_bps: u32,
    /// Maximum automatic recovery attempts before marking Abandoned.
    pub max_recovery_attempts: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentTimeout {
    /// Links back to the `ChargeAttempt` id.
    pub charge_id: u64,
    pub subscription_id: u64,
    pub chain_id: u64,
    pub status: TimeoutStatus,
    /// Ledger timestamp when the payment was first submitted.
    pub submitted_at: u64,
    /// Ledger timestamp when the timeout was first detected.
    pub timed_out_at: u64,
    /// Ledger timestamp of the most recent recovery attempt.
    pub last_recovery_at: u64,
    /// Number of recovery attempts so far.
    pub recovery_attempts: u32,
    /// Gas price used on the last recovery attempt (in stroops or wei-equivalent).
    pub last_gas_price: u64,
    /// Human-readable status note.
    pub note: String,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
enum TimeoutStoreKey {
    /// Sequence counter for PaymentTimeout records.
    Count,
    /// PaymentTimeout record by charge_id.
    Record(u64),
    /// Per-subscription list of charge_ids that have timeout records.
    SubTimeouts(u64),
    /// Per-chain configuration.
    ChainConfig(u64),
}

// ── Storage helpers ───────────────────────────────────────────────────────────

fn put<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: TimeoutStoreKey, val: V) {
    env.storage().persistent().set(&key, &val);
}

fn get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: TimeoutStoreKey,
) -> Option<V> {
    env.storage().persistent().get(&key)
}

fn sub_timeout_ids(env: &Env, subscription_id: u64) -> Vec<u64> {
    get(env, TimeoutStoreKey::SubTimeouts(subscription_id)).unwrap_or(Vec::new(env))
}

fn set_sub_timeout_ids(env: &Env, subscription_id: u64, ids: Vec<u64>) {
    put(env, TimeoutStoreKey::SubTimeouts(subscription_id), ids);
}

// ── Chain config ──────────────────────────────────────────────────────────────

/// Store a per-chain timeout configuration.  Admin-only in practice (callers
/// must enforce auth before calling this function).
pub(crate) fn set_chain_config(env: &Env, config: ChainTimeoutConfig) {
    assert!(
        config.timeout_secs > 0 && config.timeout_secs <= MAX_TIMEOUT_SECS,
        "timeout_secs out of range"
    );
    assert!(
        config.max_recovery_attempts <= MAX_RECOVERY_ATTEMPTS,
        "max_recovery_attempts exceeds cap"
    );
    put(env, TimeoutStoreKey::ChainConfig(config.chain_id), config);
}

/// Retrieve configuration for a chain, falling back to defaults.
pub(crate) fn get_chain_config(env: &Env, chain_id: u64) -> ChainTimeoutConfig {
    get(env, TimeoutStoreKey::ChainConfig(chain_id)).unwrap_or(ChainTimeoutConfig {
        chain_id,
        timeout_secs: DEFAULT_TIMEOUT_SECS,
        gas_bump_bps: DEFAULT_GAS_BUMP_BPS,
        max_recovery_attempts: MAX_RECOVERY_ATTEMPTS,
    })
}

// ── Core lifecycle ────────────────────────────────────────────────────────────

/// Register a new pending payment so its timeout window can be tracked.
pub(crate) fn register_pending(
    env: &Env,
    charge_id: u64,
    subscription_id: u64,
    chain_id: u64,
    initial_gas_price: u64,
) -> PaymentTimeout {
    let record = PaymentTimeout {
        charge_id,
        subscription_id,
        chain_id,
        status: TimeoutStatus::Pending,
        submitted_at: env.ledger().timestamp(),
        timed_out_at: 0,
        last_recovery_at: 0,
        recovery_attempts: 0,
        last_gas_price: initial_gas_price,
        note: String::from_str(env, "submitted"),
    };

    put(env, TimeoutStoreKey::Record(charge_id), record.clone());

    let mut ids = sub_timeout_ids(env, subscription_id);
    ids.push_back(charge_id);
    set_sub_timeout_ids(env, subscription_id, ids);

    env.events().publish(
        (
            String::from_str(env, "payment_timeout_registered"),
            subscription_id,
        ),
        (charge_id, chain_id, record.submitted_at),
    );

    record
}

/// Check whether the pending payment has exceeded its chain timeout window.
/// Returns `true` and transitions to `TimedOut` when timed out for the first
/// time.  Safe to call repeatedly — subsequent calls return `true` without
/// re-emitting the event.
pub(crate) fn detect_timeout(env: &Env, charge_id: u64) -> bool {
    let mut record: PaymentTimeout = match get(env, TimeoutStoreKey::Record(charge_id)) {
        Some(r) => r,
        None => return false,
    };

    if record.status != TimeoutStatus::Pending {
        return record.status == TimeoutStatus::TimedOut
            || record.status == TimeoutStatus::Recovering;
    }

    let config = get_chain_config(env, record.chain_id);
    let now = env.ledger().timestamp();

    if now < record.submitted_at + config.timeout_secs {
        return false;
    }

    // First detection — transition to TimedOut.
    record.status = TimeoutStatus::TimedOut;
    record.timed_out_at = now;
    record.note = String::from_str(env, "timeout_detected");
    put(env, TimeoutStoreKey::Record(charge_id), record.clone());

    env.events().publish(
        (
            String::from_str(env, "payment_timed_out"),
            record.subscription_id,
        ),
        (
            charge_id,
            record.chain_id,
            record.submitted_at,
            record.timed_out_at,
        ),
    );

    true
}

/// Attempt recovery of a timed-out payment with a higher gas price.
///
/// Returns the updated `PaymentTimeout` if recovery was initiated, or `None`
/// when the charge is not timed-out / all attempts exhausted / chain reorg
/// window not yet elapsed.
pub(crate) fn attempt_recovery(
    env: &Env,
    charge_id: u64,
    new_gas_price: u64,
) -> Option<PaymentTimeout> {
    let mut record: PaymentTimeout = get(env, TimeoutStoreKey::Record(charge_id))?;

    if record.status != TimeoutStatus::TimedOut && record.status != TimeoutStatus::Recovering {
        return None;
    }

    let config = get_chain_config(env, record.chain_id);

    if record.recovery_attempts >= config.max_recovery_attempts {
        record.status = TimeoutStatus::Abandoned;
        record.note = String::from_str(env, "max_recovery_attempts_exhausted");
        put(env, TimeoutStoreKey::Record(charge_id), record.clone());

        env.events().publish(
            (
                String::from_str(env, "payment_recovery_abandoned"),
                record.subscription_id,
            ),
            (charge_id, record.recovery_attempts),
        );

        return None;
    }

    // Apply minimum gas bump to prevent RPC node inconsistency causing silent drops.
    let min_bumped =
        record.last_gas_price + (record.last_gas_price * config.gas_bump_bps as u64) / 10_000;
    let effective_gas = if new_gas_price > min_bumped {
        new_gas_price
    } else {
        min_bumped
    };

    let now = env.ledger().timestamp();
    record.recovery_attempts += 1;
    record.last_recovery_at = now;
    record.last_gas_price = effective_gas;
    record.status = TimeoutStatus::Recovering;
    record.note = String::from_str(env, "recovery_in_flight");
    put(env, TimeoutStoreKey::Record(charge_id), record.clone());

    env.events().publish(
        (
            String::from_str(env, "payment_recovery_attempt"),
            record.subscription_id,
        ),
        (charge_id, record.recovery_attempts, effective_gas, now),
    );

    Some(record)
}

/// Mark a timed-out payment as resolved (confirmed on-chain after recovery).
pub(crate) fn mark_resolved(env: &Env, charge_id: u64) -> Option<PaymentTimeout> {
    let mut record: PaymentTimeout = get(env, TimeoutStoreKey::Record(charge_id))?;

    if record.status == TimeoutStatus::Resolved || record.status == TimeoutStatus::Abandoned {
        return Some(record);
    }

    record.status = TimeoutStatus::Resolved;
    record.note = String::from_str(env, "confirmed_on_chain");
    put(env, TimeoutStoreKey::Record(charge_id), record.clone());

    env.events().publish(
        (
            String::from_str(env, "payment_timeout_resolved"),
            record.subscription_id,
        ),
        (charge_id, env.ledger().timestamp()),
    );

    Some(record)
}

/// Manual retry requested by a user.  Validates that the transaction is in a
/// retryable state and bumps the recovery attempt counter.
pub(crate) fn manual_retry(
    env: &Env,
    charge_id: u64,
    new_gas_price: u64,
) -> Option<PaymentTimeout> {
    let record: PaymentTimeout = get(env, TimeoutStoreKey::Record(charge_id))?;

    // Allow manual retry from any non-terminal state.
    if record.status == TimeoutStatus::Resolved || record.status == TimeoutStatus::Abandoned {
        return None;
    }

    attempt_recovery(env, charge_id, new_gas_price)
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/// Retrieve a single timeout record.
pub(crate) fn get_timeout_record(env: &Env, charge_id: u64) -> Option<PaymentTimeout> {
    get(env, TimeoutStoreKey::Record(charge_id))
}

/// List all timeout records for a subscription.
pub(crate) fn get_subscription_timeouts(env: &Env, subscription_id: u64) -> Vec<PaymentTimeout> {
    let ids = sub_timeout_ids(env, subscription_id);
    let mut records: Vec<PaymentTimeout> = Vec::new(env);
    let mut i = 0u32;
    while i < ids.len() {
        let charge_id = ids.get_unchecked(i);
        if let Some(rec) = get_timeout_record(env, charge_id) {
            records.push_back(rec);
        }
        i += 1;
    }
    records
}

/// Return all timeout records for a subscription that are currently stuck
/// (TimedOut or Recovering).
pub(crate) fn get_stuck_transactions(env: &Env, subscription_id: u64) -> Vec<PaymentTimeout> {
    let all = get_subscription_timeouts(env, subscription_id);
    let mut stuck: Vec<PaymentTimeout> = Vec::new(env);
    let mut i = 0u32;
    while i < all.len() {
        let rec = all.get_unchecked(i);
        if rec.status == TimeoutStatus::TimedOut || rec.status == TimeoutStatus::Recovering {
            stuck.push_back(rec);
        }
        i += 1;
    }
    stuck
}

/// Transaction health summary for the dashboard.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TxHealthSummary {
    pub total: u32,
    pub pending: u32,
    pub timed_out: u32,
    pub recovering: u32,
    pub resolved: u32,
    pub abandoned: u32,
}

/// Compute a health summary across all timeout records for a subscription.
pub(crate) fn get_health_summary(env: &Env, subscription_id: u64) -> TxHealthSummary {
    let all = get_subscription_timeouts(env, subscription_id);
    let mut summary = TxHealthSummary {
        total: 0,
        pending: 0,
        timed_out: 0,
        recovering: 0,
        resolved: 0,
        abandoned: 0,
    };

    let mut i = 0u32;
    while i < all.len() {
        let rec = all.get_unchecked(i);
        summary.total += 1;
        match rec.status {
            TimeoutStatus::Pending => summary.pending += 1,
            TimeoutStatus::TimedOut => summary.timed_out += 1,
            TimeoutStatus::Recovering => summary.recovering += 1,
            TimeoutStatus::Resolved => summary.resolved += 1,
            TimeoutStatus::Abandoned => summary.abandoned += 1,
        }
        i += 1;
    }

    summary
}
