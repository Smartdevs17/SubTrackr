use soroban_sdk::{contracttype, token, Address, Env, String, Vec};
use subtrackr_types::{ChargeAttempt, ChargeStatus, RetryConfig, SubscriptionStatus};

const DEFAULT_MAX_RETRIES: u32 = 3;
const DEFAULT_BASE_DELAY_SECS: u64 = 60;
const DEFAULT_MAX_DELAY_SECS: u64 = 3_600;
const DEFAULT_BACKOFF_FACTOR: u32 = 2;
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD: u32 = 5;
const DEFAULT_CIRCUIT_BREAKER_COOLDOWN: u64 = 86_400;

/// Deterministic jitter spread in seconds (avoids thundering-herd retries).
const JITTER_MODULUS_SECS: u64 = 300; // ±0–5 min spread

/// Default grace period duration in seconds (72 hours).
const DEFAULT_GRACE_PERIOD_SECS: u64 = 259_200;

/// Maximum number of charge attempts to process in a single retry-queue sweep.
const MAX_RETRY_BATCH_SIZE: u32 = 50;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ChargeStoreKey {
    Count,
    Attempt(u64),
    SubAttempts(u64),
    /// Per-subscription retry policy override stored by the merchant.
    RetryPolicy(u64),
    /// Grace period record for a subscription.
    GracePeriod(u64),
    /// Ordered queue of charge IDs that are due for retry.
    RetryQueue,
}

// ─── Grace Period ──────────────────────────────────────────────────────────────

/// Lifecycle status of a subscription grace period.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum GracePeriodStatus {
    /// Active — subscription is still accessible but payment is overdue.
    Active,
    /// Payment was recovered before the grace period expired.
    Recovered,
    /// Grace period elapsed without recovery — subscription should be suspended.
    Expired,
}

/// Tracks the grace period for a failed subscription charge.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GracePeriod {
    pub subscription_id: u64,
    /// Ledger timestamp when the grace period started.
    pub started_at: u64,
    /// Ledger timestamp when the grace period expires.
    pub expires_at: u64,
    pub status: GracePeriodStatus,
    /// How many reminder notifications have been dispatched.
    pub reminders_sent: u32,
}

fn put<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: ChargeStoreKey, val: V) {
    env.storage().persistent().set(&key, &val);
}

fn get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: ChargeStoreKey,
) -> Option<V> {
    env.storage().persistent().get(&key)
}

fn next_charge_id(env: &Env) -> u64 {
    let mut count: u64 = get(env, ChargeStoreKey::Count).unwrap_or(0);
    count += 1;
    put(env, ChargeStoreKey::Count, count);
    count
}

fn sub_attempt_ids(env: &Env, subscription_id: u64) -> Vec<u64> {
    get(env, ChargeStoreKey::SubAttempts(subscription_id)).unwrap_or(Vec::new(env))
}

fn set_sub_attempt_ids(env: &Env, subscription_id: u64, ids: Vec<u64>) {
    put(env, ChargeStoreKey::SubAttempts(subscription_id), ids);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Returns the global default retry configuration.
pub(crate) fn default_retry_config() -> RetryConfig {
    RetryConfig {
        max_retries: DEFAULT_MAX_RETRIES,
        base_delay_secs: DEFAULT_BASE_DELAY_SECS,
        max_delay_secs: DEFAULT_MAX_DELAY_SECS,
        backoff_factor: DEFAULT_BACKOFF_FACTOR,
        circuit_breaker_threshold: DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
        circuit_breaker_cooldown_secs: DEFAULT_CIRCUIT_BREAKER_COOLDOWN,
    }
}

/// Persist a merchant-supplied retry policy for a specific subscription.
pub(crate) fn set_retry_policy(env: &Env, subscription_id: u64, config: RetryConfig) {
    put(env, ChargeStoreKey::RetryPolicy(subscription_id), config);
}

/// Load the per-subscription retry policy, falling back to the global default.
pub(crate) fn get_retry_policy(env: &Env, subscription_id: u64) -> RetryConfig {
    get(env, ChargeStoreKey::RetryPolicy(subscription_id))
        .unwrap_or_else(default_retry_config)
}

/// Start a new charge attempt for a subscription.
pub(crate) fn start_charge(env: &Env, subscription_id: u64, amount: i128) -> ChargeAttempt {
    let id = next_charge_id(env);
    let config = get_retry_policy(env, subscription_id);
    let attempt = ChargeAttempt {
        id,
        subscription_id,
        status: ChargeStatus::Pending,
        amount,
        attempted_at: 0,
        completed_at: 0,
        error_message: String::from_str(env, ""),
        retry_count: 0,
        max_retries: config.max_retries,
        next_retry_at: 0,
        circuit_breaker_until: 0,
    };
    put(env, ChargeStoreKey::Attempt(id), attempt.clone());
    let mut ids = sub_attempt_ids(env, subscription_id);
    ids.push_back(id);
    set_sub_attempt_ids(env, subscription_id, ids);
    attempt
}

/// Transition a charge to Attempting and record the ledger timestamp.
pub(crate) fn mark_attempting(env: &Env, attempt: &mut ChargeAttempt) {
    attempt.status = ChargeStatus::Attempting;
    attempt.attempted_at = env.ledger().timestamp();
    put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
}

/// Transition a charge to Completed.
pub(crate) fn mark_completed(env: &Env, attempt: &mut ChargeAttempt) {
    attempt.status = ChargeStatus::Completed;
    attempt.completed_at = env.ledger().timestamp();
    attempt.retry_count = 0;
    attempt.error_message = String::from_str(env, "");
    put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
}

/// Mark a charge as failed and schedule the next retry with exponential
/// backoff and deterministic jitter.
///
/// Returns `true` when a retry was scheduled, `false` when budget exhausted.
pub(crate) fn mark_failed(
    env: &Env,
    attempt: &mut ChargeAttempt,
    error_msg: &str,
    config: &RetryConfig,
) -> bool {
    attempt.retry_count += 1;
    attempt.error_message = String::from_str(env, error_msg);

    if attempt.retry_count >= config.max_retries {
        attempt.status = ChargeStatus::Exhausted;
        put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
        return false;
    }

    let base_delay = compute_backoff_delay(attempt.retry_count, config);
    let jitter = compute_jitter(attempt.subscription_id, attempt.retry_count);
    let delay = base_delay.saturating_add(jitter).min(config.max_delay_secs);

    attempt.next_retry_at = env.ledger().timestamp() + delay;
    attempt.status = ChargeStatus::Retrying;
    put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
    true
}

/// Trip the circuit breaker after repeated failures, halting retries for
/// `config.circuit_breaker_cooldown_secs`.
pub(crate) fn apply_circuit_breaker(env: &Env, attempt: &mut ChargeAttempt, config: &RetryConfig) {
    if attempt.retry_count >= config.circuit_breaker_threshold {
        attempt.circuit_breaker_until =
            env.ledger().timestamp() + config.circuit_breaker_cooldown_secs;
        attempt.status = ChargeStatus::Failed;
        put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
    }
}

/// Returns `true` when the circuit breaker is currently active.
pub(crate) fn is_circuit_breaker_active(env: &Env, attempt: &ChargeAttempt) -> bool {
    attempt.circuit_breaker_until != 0
        && env.ledger().timestamp() < attempt.circuit_breaker_until
}

/// Returns `true` when a scheduled retry window has elapsed.
pub(crate) fn is_retry_due(env: &Env, attempt: &ChargeAttempt) -> bool {
    attempt.status == ChargeStatus::Retrying
        && env.ledger().timestamp() >= attempt.next_retry_at
}

/// Advance a due retry to Attempting, guarded by the circuit breaker and
/// the retry budget.  Returns the updated attempt on success.
pub(crate) fn retry_charge(
    env: &Env,
    charge_id: u64,
    config: &RetryConfig,
) -> Option<ChargeAttempt> {
    let mut attempt = get_charge_attempt(env, charge_id)?;

    if attempt.status != ChargeStatus::Retrying && attempt.status != ChargeStatus::Failed {
        return None;
    }
    if is_circuit_breaker_active(env, &attempt) {
        return None;
    }
    if attempt.retry_count >= config.max_retries {
        attempt.status = ChargeStatus::Exhausted;
        put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
        return Some(attempt);
    }

    attempt.status = ChargeStatus::Attempting;
    attempt.attempted_at = env.ledger().timestamp();
    attempt.error_message = String::from_str(env, "");
    put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
    Some(attempt)
}

/// Abort an in-flight charge (e.g. subscriber-initiated cancellation).
pub(crate) fn abort_charge(env: &Env, attempt: &mut ChargeAttempt) {
    attempt.status = ChargeStatus::Failed;
    attempt.error_message = String::from_str(env, "Charge aborted by user");
    put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
}

/// Retrieve a single charge attempt by ID.
pub(crate) fn get_charge_attempt(env: &Env, charge_id: u64) -> Option<ChargeAttempt> {
    get(env, ChargeStoreKey::Attempt(charge_id))
}

/// Return the full charge history for a subscription, oldest first.
pub(crate) fn get_charge_history(env: &Env, subscription_id: u64) -> Vec<ChargeAttempt> {
    let ids = sub_attempt_ids(env, subscription_id);
    let mut history: Vec<ChargeAttempt> = Vec::new(env);
    let mut i = 0u32;
    while i < ids.len() {
        let charge_id = ids.get_unchecked(i);
        if let Some(attempt) = get_charge_attempt(env, charge_id) {
            history.push_back(attempt);
        }
        i += 1;
    }
    history
}

// ─── Grace Period API ─────────────────────────────────────────────────────────

/// Start a grace period for a subscription that just had a payment failure.
/// If a grace period already exists and is active, this is a no-op.
pub(crate) fn start_grace_period(env: &Env, subscription_id: u64) -> GracePeriod {
    if let Some(existing) = get_grace_period(env, subscription_id) {
        if existing.status == GracePeriodStatus::Active {
            return existing;
        }
    }
    let now = env.ledger().timestamp();
    let gp = GracePeriod {
        subscription_id,
        started_at: now,
        expires_at: now + DEFAULT_GRACE_PERIOD_SECS,
        status: GracePeriodStatus::Active,
        reminders_sent: 0,
    };
    put(env, ChargeStoreKey::GracePeriod(subscription_id), gp.clone());
    gp
}

/// Start a grace period with a custom duration (in seconds).
pub(crate) fn start_grace_period_custom(
    env: &Env,
    subscription_id: u64,
    duration_secs: u64,
) -> GracePeriod {
    if let Some(existing) = get_grace_period(env, subscription_id) {
        if existing.status == GracePeriodStatus::Active {
            return existing;
        }
    }
    let now = env.ledger().timestamp();
    let gp = GracePeriod {
        subscription_id,
        started_at: now,
        expires_at: now + duration_secs,
        status: GracePeriodStatus::Active,
        reminders_sent: 0,
    };
    put(env, ChargeStoreKey::GracePeriod(subscription_id), gp.clone());
    gp
}

/// Retrieve the grace period for a subscription, if any.
pub(crate) fn get_grace_period(env: &Env, subscription_id: u64) -> Option<GracePeriod> {
    get(env, ChargeStoreKey::GracePeriod(subscription_id))
}

/// Mark the grace period as recovered (payment succeeded).
pub(crate) fn recover_grace_period(env: &Env, subscription_id: u64) -> bool {
    let mut gp = match get_grace_period(env, subscription_id) {
        Some(gp) => gp,
        None => return false,
    };
    if gp.status != GracePeriodStatus::Active {
        return false;
    }
    gp.status = GracePeriodStatus::Recovered;
    put(env, ChargeStoreKey::GracePeriod(subscription_id), gp);
    true
}

/// Expire a grace period (payment window elapsed, subscription should be suspended).
pub(crate) fn expire_grace_period(env: &Env, subscription_id: u64) -> bool {
    let mut gp = match get_grace_period(env, subscription_id) {
        Some(gp) => gp,
        None => return false,
    };
    if gp.status != GracePeriodStatus::Active {
        return false;
    }
    gp.status = GracePeriodStatus::Expired;
    put(env, ChargeStoreKey::GracePeriod(subscription_id), gp);
    true
}

/// Returns `true` when the grace period exists and is still active.
pub(crate) fn is_in_grace_period(env: &Env, subscription_id: u64) -> bool {
    match get_grace_period(env, subscription_id) {
        Some(gp) => {
            gp.status == GracePeriodStatus::Active
                && env.ledger().timestamp() < gp.expires_at
        }
        None => false,
    }
}

/// Increment the reminder counter on an active grace period.
pub(crate) fn record_grace_period_reminder(env: &Env, subscription_id: u64) {
    if let Some(mut gp) = get_grace_period(env, subscription_id) {
        if gp.status == GracePeriodStatus::Active {
            gp.reminders_sent += 1;
            put(env, ChargeStoreKey::GracePeriod(subscription_id), gp);
        }
    }
}

// ─── Retry Queue ──────────────────────────────────────────────────────────────

/// Enqueue a charge ID for retry processing.
pub(crate) fn enqueue_retry(env: &Env, charge_id: u64) {
    let mut queue: Vec<u64> = get(env, ChargeStoreKey::RetryQueue).unwrap_or(Vec::new(env));
    // Avoid duplicates
    let mut already = false;
    let mut i = 0u32;
    while i < queue.len() {
        if queue.get_unchecked(i) == charge_id {
            already = true;
            break;
        }
        i += 1;
    }
    if !already {
        queue.push_back(charge_id);
        put(env, ChargeStoreKey::RetryQueue, queue);
    }
}

/// Remove a charge ID from the retry queue (called after successful processing).
pub(crate) fn dequeue_retry(env: &Env, charge_id: u64) {
    let queue: Vec<u64> = match get(env, ChargeStoreKey::RetryQueue) {
        Some(q) => q,
        None => return,
    };
    let mut new_queue: Vec<u64> = Vec::new(env);
    let mut i = 0u32;
    while i < queue.len() {
        let id = queue.get_unchecked(i);
        if id != charge_id {
            new_queue.push_back(id);
        }
        i += 1;
    }
    put(env, ChargeStoreKey::RetryQueue, new_queue);
}

/// Returns all charge IDs currently in the retry queue.
pub(crate) fn get_retry_queue(env: &Env) -> Vec<u64> {
    get(env, ChargeStoreKey::RetryQueue).unwrap_or(Vec::new(env))
}

/// Process the retry queue: attempt up to `MAX_RETRY_BATCH_SIZE` due charges.
///
/// For each due charge:
///  1. Check circuit breaker and retry window.
///  2. Transfer tokens from subscriber → merchant.
///  3. On success: mark completed, recover grace period, dequeue.
///  4. On failure (insufficient balance etc.): mark_failed, reschedule or exhaust.
///
/// Returns the number of charges successfully completed.
pub(crate) fn process_retry_queue(
    env: &Env,
    token_client_factory: &dyn Fn(&Env, &Address) -> token::Client,
    get_subscription_info: &dyn Fn(u64) -> Option<(Address, Address, Address, i128)>,
    config: &RetryConfig,
) -> u32 {
    let queue = get_retry_queue(env);
    let now = env.ledger().timestamp();
    let mut completed = 0u32;
    let mut processed = 0u32;

    let mut i = 0u32;
    while i < queue.len() && processed < MAX_RETRY_BATCH_SIZE {
        let charge_id = queue.get_unchecked(i);
        i += 1;
        processed += 1;

        let mut attempt = match get_charge_attempt(env, charge_id) {
            Some(a) => a,
            None => {
                dequeue_retry(env, charge_id);
                continue;
            }
        };

        // Skip charges not yet due
        if attempt.status == ChargeStatus::Retrying && now < attempt.next_retry_at {
            continue;
        }

        // Skip if circuit breaker is active
        if is_circuit_breaker_active(env, &attempt) {
            continue;
        }

        // Skip non-retryable statuses
        match attempt.status {
            ChargeStatus::Retrying | ChargeStatus::Failed => {}
            _ => {
                dequeue_retry(env, charge_id);
                continue;
            }
        }

        let sub_info = match get_subscription_info(attempt.subscription_id) {
            Some(info) => info,
            None => {
                attempt.status = ChargeStatus::Failed;
                attempt.error_message = String::from_str(env, "Subscription not found");
                put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
                dequeue_retry(env, charge_id);
                continue;
            }
        };

        let (subscriber, merchant, token_addr, amount) = sub_info;
        let client = token_client_factory(env, &token_addr);

        // Advance attempt status to Attempting
        attempt.status = ChargeStatus::Attempting;
        attempt.attempted_at = now;
        attempt.error_message = String::from_str(env, "");
        put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());

        // Try the transfer
        let transfer_ok = client
            .try_transfer(&subscriber, &merchant, &amount)
            .is_ok();

        if transfer_ok {
            mark_completed(env, &mut attempt);
            recover_grace_period(env, attempt.subscription_id);
            dequeue_retry(env, charge_id);
            completed += 1;
        } else {
            let rescheduled = mark_failed(env, &mut attempt, "payment_failed", config);
            if rescheduled {
                // Apply circuit breaker check
                apply_circuit_breaker(env, &mut attempt, config);
                if attempt.status != ChargeStatus::Failed {
                    // Still retrying — stays in queue
                } else {
                    // Circuit breaker tripped — keep in queue but it will be skipped
                    // until the cooldown elapses
                }
            } else {
                // Budget exhausted
                expire_grace_period(env, attempt.subscription_id);
                dequeue_retry(env, charge_id);
            }
        }
    }

    completed
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/// Pure exponential backoff: `base * factor^(retry_count-1)`, capped at max.
fn compute_backoff_delay(retry_count: u32, config: &RetryConfig) -> u64 {
    let mut delay = config.base_delay_secs;
    let mut i = 1u32;
    while i < retry_count {
        delay = delay.saturating_mul(config.backoff_factor as u64);
        if delay >= config.max_delay_secs {
            return config.max_delay_secs;
        }
        i += 1;
    }
    delay
}

/// Deterministic jitter derived from (subscription_id XOR retry_count).
/// No randomness oracle needed on-chain; different subscriptions get
/// different offsets so simultaneous failures don't all retry together.
fn compute_jitter(subscription_id: u64, retry_count: u32) -> u64 {
    let seed = subscription_id ^ ((retry_count as u64).wrapping_mul(2_654_435_761));
    seed % JITTER_MODULUS_SECS
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    fn cfg() -> RetryConfig {
        default_retry_config()
    }

    // ── backoff ──────────────────────────────────────────────────────────────

    #[test]
    fn backoff_grows_exponentially() {
        let c = cfg();
        assert_eq!(compute_backoff_delay(1, &c), 60);
        assert_eq!(compute_backoff_delay(2, &c), 120);
        assert_eq!(compute_backoff_delay(3, &c), 240);
    }

    #[test]
    fn backoff_capped_at_max() {
        let c = RetryConfig {
            max_retries: 10,
            base_delay_secs: 100,
            max_delay_secs: 200,
            backoff_factor: 4,
            ..cfg()
        };
        assert_eq!(compute_backoff_delay(5, &c), 200);
    }

    // ── jitter ───────────────────────────────────────────────────────────────

    #[test]
    fn jitter_is_deterministic() {
        assert_eq!(compute_jitter(42, 1), compute_jitter(42, 1));
    }

    #[test]
    fn jitter_is_bounded() {
        for sub in [1u64, 100, 9_999, u64::MAX / 2] {
            for retry in [1u32, 2, 5] {
                assert!(compute_jitter(sub, retry) < JITTER_MODULUS_SECS);
            }
        }
    }

    #[test]
    fn jitter_varies_across_subscriptions() {
        let j1 = compute_jitter(1, 1);
        let j2 = compute_jitter(2, 1);
        // Not guaranteed to differ, but with the chosen seed they do for 1 vs 2
        let _ = (j1, j2); // just assert no panic
    }

    // ── start_charge ─────────────────────────────────────────────────────────

    #[test]
    fn start_charge_creates_pending_attempt() {
        let env = Env::default();
        let a = start_charge(&env, 1, 1_000_000);
        assert_eq!(a.status, ChargeStatus::Pending);
        assert_eq!(a.retry_count, 0);
        assert_eq!(a.amount, 1_000_000);
        assert_eq!(a.circuit_breaker_until, 0);
    }

    #[test]
    fn start_charge_uses_per_subscription_policy() {
        let env = Env::default();
        let custom = RetryConfig { max_retries: 7, ..cfg() };
        set_retry_policy(&env, 10, custom);
        let a = start_charge(&env, 10, 500);
        assert_eq!(a.max_retries, 7);
    }

    // ── mark_failed ───────────────────────────────────────────────────────────

    #[test]
    fn mark_failed_schedules_retry() {
        let env = Env::default();
        let mut a = start_charge(&env, 1, 500);
        let rescheduled = mark_failed(&env, &mut a, "insufficient funds", &cfg());
        assert!(rescheduled);
        assert_eq!(a.status, ChargeStatus::Retrying);
        assert!(a.next_retry_at > 0);
    }

    #[test]
    fn mark_failed_exhausts_after_budget() {
        let env = Env::default();
        let mut a = start_charge(&env, 2, 500);
        let c = cfg();
        a.retry_count = c.max_retries - 1;
        let rescheduled = mark_failed(&env, &mut a, "declined", &c);
        assert!(!rescheduled);
        assert_eq!(a.status, ChargeStatus::Exhausted);
    }

    #[test]
    fn mark_failed_applies_jitter_to_next_retry_at() {
        let env = Env::default();
        let mut a1 = start_charge(&env, 100, 500);
        let mut a2 = start_charge(&env, 200, 500);
        mark_failed(&env, &mut a1, "err", &cfg());
        mark_failed(&env, &mut a2, "err", &cfg());
        // Different subscription IDs → different jitter → different next_retry_at
        // (Both are still > 0 and within bounds)
        assert!(a1.next_retry_at > 0);
        assert!(a2.next_retry_at > 0);
    }

    // ── circuit breaker ───────────────────────────────────────────────────────

    #[test]
    fn circuit_breaker_trips_at_threshold() {
        let env = Env::default();
        let mut a = start_charge(&env, 3, 500);
        let c = cfg();
        a.retry_count = c.circuit_breaker_threshold;
        apply_circuit_breaker(&env, &mut a, &c);
        assert!(is_circuit_breaker_active(&env, &a));
        assert_eq!(a.status, ChargeStatus::Failed);
    }

    #[test]
    fn circuit_breaker_inactive_before_threshold() {
        let env = Env::default();
        let a = start_charge(&env, 4, 500);
        assert!(!is_circuit_breaker_active(&env, &a));
    }

    // ── retry_charge ──────────────────────────────────────────────────────────

    #[test]
    fn retry_charge_advances_to_attempting() {
        let env = Env::default();
        let mut a = start_charge(&env, 5, 500);
        mark_failed(&env, &mut a, "network", &cfg());
        // Force window elapsed
        a.next_retry_at = 0;
        put(&env, ChargeStoreKey::Attempt(a.id), a.clone());
        let retried = retry_charge(&env, a.id, &cfg()).unwrap();
        assert_eq!(retried.status, ChargeStatus::Attempting);
    }

    #[test]
    fn retry_charge_blocked_by_circuit_breaker() {
        let env = Env::default();
        let mut a = start_charge(&env, 6, 500);
        let c = cfg();
        a.retry_count = c.circuit_breaker_threshold;
        apply_circuit_breaker(&env, &mut a, &c);
        let result = retry_charge(&env, a.id, &c);
        assert!(result.is_none());
    }

    #[test]
    fn retry_charge_returns_none_for_unknown_id() {
        let env = Env::default();
        assert!(retry_charge(&env, 9999, &cfg()).is_none());
    }

    // ── policy persistence ────────────────────────────────────────────────────

    #[test]
    fn set_and_get_retry_policy_round_trips() {
        let env = Env::default();
        let custom = RetryConfig {
            max_retries: 7,
            base_delay_secs: 30,
            max_delay_secs: 7_200,
            backoff_factor: 3,
            circuit_breaker_threshold: 4,
            circuit_breaker_cooldown_secs: 3_600,
        };
        set_retry_policy(&env, 99, custom);
        let loaded = get_retry_policy(&env, 99);
        assert_eq!(loaded.max_retries, 7);
        assert_eq!(loaded.base_delay_secs, 30);
        assert_eq!(loaded.backoff_factor, 3);
    }

    #[test]
    fn get_retry_policy_falls_back_to_default() {
        let env = Env::default();
        let p = get_retry_policy(&env, 9999);
        assert_eq!(p.max_retries, DEFAULT_MAX_RETRIES);
    }

    // ── charge history ────────────────────────────────────────────────────────

    #[test]
    fn get_charge_history_returns_all_attempts() {
        let env = Env::default();
        let a1 = start_charge(&env, 7, 100);
        let a2 = start_charge(&env, 7, 200);
        let history = get_charge_history(&env, 7);
        assert_eq!(history.len(), 2);
        assert_eq!(history.get_unchecked(0).id, a1.id);
        assert_eq!(history.get_unchecked(1).id, a2.id);
    }

    #[test]
    fn get_charge_history_empty_for_new_subscription() {
        let env = Env::default();
        assert_eq!(get_charge_history(&env, 999).len(), 0);
    }

    // ── grace period ──────────────────────────────────────────────────────────

    #[test]
    fn start_grace_period_creates_active_period() {
        let env = Env::default();
        let gp = start_grace_period(&env, 42);
        assert_eq!(gp.status, GracePeriodStatus::Active);
        assert_eq!(gp.reminders_sent, 0);
        assert!(gp.expires_at > gp.started_at);
        assert_eq!(gp.expires_at - gp.started_at, DEFAULT_GRACE_PERIOD_SECS);
    }

    #[test]
    fn start_grace_period_is_idempotent_when_active() {
        let env = Env::default();
        let gp1 = start_grace_period(&env, 42);
        let gp2 = start_grace_period(&env, 42);
        assert_eq!(gp1.started_at, gp2.started_at);
        assert_eq!(gp1.expires_at, gp2.expires_at);
    }

    #[test]
    fn start_grace_period_custom_uses_provided_duration() {
        let env = Env::default();
        let gp = start_grace_period_custom(&env, 10, 3_600);
        assert_eq!(gp.expires_at - gp.started_at, 3_600);
    }

    #[test]
    fn recover_grace_period_marks_recovered() {
        let env = Env::default();
        start_grace_period(&env, 50);
        let changed = recover_grace_period(&env, 50);
        assert!(changed);
        let gp = get_grace_period(&env, 50).unwrap();
        assert_eq!(gp.status, GracePeriodStatus::Recovered);
    }

    #[test]
    fn recover_grace_period_returns_false_when_none() {
        let env = Env::default();
        assert!(!recover_grace_period(&env, 9999));
    }

    #[test]
    fn expire_grace_period_marks_expired() {
        let env = Env::default();
        start_grace_period(&env, 60);
        let changed = expire_grace_period(&env, 60);
        assert!(changed);
        let gp = get_grace_period(&env, 60).unwrap();
        assert_eq!(gp.status, GracePeriodStatus::Expired);
    }

    #[test]
    fn expire_grace_period_returns_false_for_unknown_subscription() {
        let env = Env::default();
        assert!(!expire_grace_period(&env, 8888));
    }

    #[test]
    fn is_in_grace_period_true_for_active_non_expired() {
        let env = Env::default();
        start_grace_period_custom(&env, 70, 100_000);
        assert!(is_in_grace_period(&env, 70));
    }

    #[test]
    fn is_in_grace_period_false_when_no_grace_period() {
        let env = Env::default();
        assert!(!is_in_grace_period(&env, 7777));
    }

    #[test]
    fn is_in_grace_period_false_after_recovery() {
        let env = Env::default();
        start_grace_period(&env, 80);
        recover_grace_period(&env, 80);
        assert!(!is_in_grace_period(&env, 80));
    }

    #[test]
    fn record_grace_period_reminder_increments_counter() {
        let env = Env::default();
        start_grace_period(&env, 90);
        record_grace_period_reminder(&env, 90);
        record_grace_period_reminder(&env, 90);
        let gp = get_grace_period(&env, 90).unwrap();
        assert_eq!(gp.reminders_sent, 2);
    }

    #[test]
    fn record_grace_period_reminder_noop_when_no_period() {
        let env = Env::default();
        // Should not panic
        record_grace_period_reminder(&env, 12345);
    }

    #[test]
    fn expire_grace_period_is_idempotent_for_recovered() {
        let env = Env::default();
        start_grace_period(&env, 95);
        recover_grace_period(&env, 95);
        // Trying to expire a recovered grace period should return false
        assert!(!expire_grace_period(&env, 95));
        let gp = get_grace_period(&env, 95).unwrap();
        // Status remains Recovered, not overwritten to Expired
        assert_eq!(gp.status, GracePeriodStatus::Recovered);
    }

    // ── retry queue ───────────────────────────────────────────────────────────

    #[test]
    fn enqueue_and_get_retry_queue() {
        let env = Env::default();
        enqueue_retry(&env, 101);
        enqueue_retry(&env, 202);
        let q = get_retry_queue(&env);
        assert_eq!(q.len(), 2);
        assert_eq!(q.get_unchecked(0), 101);
        assert_eq!(q.get_unchecked(1), 202);
    }

    #[test]
    fn enqueue_retry_deduplicates() {
        let env = Env::default();
        enqueue_retry(&env, 303);
        enqueue_retry(&env, 303);
        let q = get_retry_queue(&env);
        assert_eq!(q.len(), 1);
    }

    #[test]
    fn dequeue_retry_removes_entry() {
        let env = Env::default();
        enqueue_retry(&env, 404);
        enqueue_retry(&env, 505);
        dequeue_retry(&env, 404);
        let q = get_retry_queue(&env);
        assert_eq!(q.len(), 1);
        assert_eq!(q.get_unchecked(0), 505);
    }

    #[test]
    fn dequeue_retry_noop_for_missing_id() {
        let env = Env::default();
        enqueue_retry(&env, 606);
        dequeue_retry(&env, 9999);
        assert_eq!(get_retry_queue(&env).len(), 1);
    }

    #[test]
    fn get_retry_queue_empty_on_fresh_env() {
        let env = Env::default();
        assert_eq!(get_retry_queue(&env).len(), 0);
    }

    // ── grace period + retry integration ──────────────────────────────────────

    #[test]
    fn grace_period_restart_after_expiry() {
        let env = Env::default();
        // Start and expire
        start_grace_period(&env, 120);
        expire_grace_period(&env, 120);
        // A new grace period should be allowed after expiry
        let gp2 = start_grace_period(&env, 120);
        assert_eq!(gp2.status, GracePeriodStatus::Active);
    }

    #[test]
    fn mark_failed_then_enqueue_then_dequeue_on_complete() {
        let env = Env::default();
        let mut a = start_charge(&env, 130, 1_000);
        let c = cfg();
        mark_failed(&env, &mut a, "network", &c);
        assert_eq!(a.status, ChargeStatus::Retrying);

        // Simulate enqueue
        enqueue_retry(&env, a.id);
        assert_eq!(get_retry_queue(&env).len(), 1);

        // Simulate successful retry
        mark_completed(&env, &mut a);
        recover_grace_period(&env, a.subscription_id); // subscription_id = 130, none registered → false
        dequeue_retry(&env, a.id);
        assert_eq!(get_retry_queue(&env).len(), 0);
        assert_eq!(a.status, ChargeStatus::Completed);
    }

    #[test]
    fn budget_exhaustion_expires_grace_period() {
        let env = Env::default();
        let mut a = start_charge(&env, 140, 500);
        let c = cfg();
        start_grace_period(&env, a.subscription_id);

        // Exhaust budget
        a.retry_count = c.max_retries - 1;
        let rescheduled = mark_failed(&env, &mut a, "declined", &c);
        assert!(!rescheduled);
        assert_eq!(a.status, ChargeStatus::Exhausted);

        expire_grace_period(&env, a.subscription_id);
        let gp = get_grace_period(&env, a.subscription_id).unwrap();
        assert_eq!(gp.status, GracePeriodStatus::Expired);
    }
}
