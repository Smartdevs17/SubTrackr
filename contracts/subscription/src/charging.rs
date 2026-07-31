use soroban_sdk::{contracttype, Env, String, Vec};
use subtrackr_types::{ChargeAttempt, ChargeStatus, RetryConfig};

const DEFAULT_MAX_RETRIES: u32 = 3;
const DEFAULT_BASE_DELAY_SECS: u64 = 60;
const DEFAULT_MAX_DELAY_SECS: u64 = 3600;
const DEFAULT_BACKOFF_FACTOR: u32 = 2;
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD: u32 = 5;
const DEFAULT_CIRCUIT_BREAKER_COOLDOWN: u64 = 86400;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
enum ChargeStoreKey {
    Count,
    Attempt(u64),
    SubAttempts(u64),
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

/// Get the default retry configuration.
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

/// Start a new charge attempt for a subscription.
pub(crate) fn start_charge(env: &Env, subscription_id: u64, amount: i128) -> ChargeAttempt {
    let id = next_charge_id(env);
    let attempt = ChargeAttempt {
        id,
        subscription_id,
        status: ChargeStatus::Pending,
        amount,
        attempted_at: 0,
        completed_at: 0,
        error_message: String::from_str(env, ""),
        retry_count: 0,
        max_retries: DEFAULT_MAX_RETRIES,
        next_retry_at: 0,
        circuit_breaker_until: 0,
    };

    put(env, ChargeStoreKey::Attempt(id), attempt.clone());

    let mut ids = sub_attempt_ids(env, subscription_id);
    ids.push_back(id);
    set_sub_attempt_ids(env, subscription_id, ids);

    attempt
}

/// Mark a charge as attempting (before executing the payment).
pub(crate) fn mark_attempting(env: &Env, attempt: &mut ChargeAttempt) {
    attempt.status = ChargeStatus::Attempting;
    attempt.attempted_at = env.ledger().timestamp();
    put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
}

/// Mark a charge as completed successfully.
pub(crate) fn mark_completed(env: &Env, attempt: &mut ChargeAttempt) {
    attempt.status = ChargeStatus::Completed;
    attempt.completed_at = env.ledger().timestamp();
    attempt.retry_count = 0;
    attempt.error_message = String::from_str(env, "");
    put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
}

/// Mark a charge as failed and schedule a retry with exponential backoff.
///
/// Returns `true` if a retry was scheduled, `false` if max retries exhausted.
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

    let delay = compute_backoff_delay(attempt.retry_count, config);
    attempt.next_retry_at = env.ledger().timestamp() + delay;
    attempt.status = ChargeStatus::Retrying;
    put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
    true
}

/// Apply circuit breaker: pause charging after repeated failures.
pub(crate) fn apply_circuit_breaker(env: &Env, attempt: &mut ChargeAttempt, config: &RetryConfig) {
    if attempt.retry_count >= config.circuit_breaker_threshold {
        attempt.circuit_breaker_until =
            env.ledger().timestamp() + config.circuit_breaker_cooldown_secs;
        attempt.status = ChargeStatus::Failed;
        put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
    }
}

/// Check if a circuit breaker is active for a charge attempt.
pub(crate) fn is_circuit_breaker_active(env: &Env, attempt: &ChargeAttempt) -> bool {
    if attempt.circuit_breaker_until == 0 {
        return false;
    }
    env.ledger().timestamp() < attempt.circuit_breaker_until
}

/// Abort an ongoing charge attempt.
pub(crate) fn abort_charge(env: &Env, attempt: &mut ChargeAttempt) {
    attempt.status = ChargeStatus::Failed;
    attempt.error_message = String::from_str(env, "Charge aborted by user");
    put(env, ChargeStoreKey::Attempt(attempt.id), attempt.clone());
}

/// Get a specific charge attempt by ID.
pub(crate) fn get_charge_attempt(env: &Env, charge_id: u64) -> Option<ChargeAttempt> {
    get(env, ChargeStoreKey::Attempt(charge_id))
}

/// Get the full charge history for a subscription.
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

/// Compute exponential backoff delay for a retry attempt.
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

/// Check if a retry is due (the retry window has elapsed).
pub(crate) fn is_retry_due(env: &Env, attempt: &ChargeAttempt) -> bool {
    attempt.status == ChargeStatus::Retrying && env.ledger().timestamp() >= attempt.next_retry_at
}

/// Retry a failed charge attempt. Returns the updated attempt.
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
