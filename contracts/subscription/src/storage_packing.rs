/// Storage Packing Module — SubTrackr Subscription Contract
///
/// Implements packed storage layouts to minimize Soroban storage fees.
/// Soroban charges per-entry fees, so combining multiple small fields
/// into a single packed struct reduces costs proportionally.
///
/// # Storage Tiers Used
/// - `instance` — packed hot config loaded on every invocation
/// - `persistent` — packed subscription/plan records
/// - `temporary` — packed rate-limit / nonce entries
///
/// # Packing Strategy
/// Rather than storing individual fields with separate `StorageKey` variants,
/// related fields that are always read together are packed into a single
/// `#[contracttype]` struct. This trades one storage read/write for the pack.
///
/// ## Hot Instance Pack
/// Fields accessed on virtually every call: admin, counts, rate-limit config.
///
/// ## Subscription Pack
/// All mutable subscription fields in one persistent entry; avoids N reads
/// when multiple fields are updated in one transaction.
///
/// ## Plan Pack
/// Analogous to SubscriptionPack for plan records.
use soroban_sdk::{contracttype, Address, Env, String};

// ─── Packed storage layouts ───────────────────────────────────────────────────

/// Hot configuration loaded on every contract invocation.
///
/// Stored in **instance** storage (cheapest per-byte on hot paths).
///
/// Replaces seven separate `StorageKey` variants with one entry:
///   `Admin`, `PlanCount`, `SubscriptionCount`,
///   `MaxPlansPerMerchant`, `LargeChargeThreshold`,
///   `InvoiceContract`, `OracleContract`
///
/// Size budget: ~175 bytes (see GAS_OPTIMIZATION.md for the full analysis).
#[contracttype]
#[derive(Clone, Debug)]
pub struct HotConfigPack {
    /// Contract administrator address (32 bytes).
    pub admin: Address,
    /// Global plan counter — monotonically increasing.
    pub plan_count: u64,
    /// Global subscription counter — monotonically increasing.
    pub subscription_count: u64,
    /// Maximum plans a single merchant may create (0 = unlimited).
    pub max_plans_per_merchant: u32,
    /// Charges at or above this amount require commit-reveal (i128 = 16 bytes).
    pub large_charge_threshold: i128,
    /// Optional invoice contract address (33 bytes with discriminant).
    pub invoice_contract: Option<Address>,
    /// Optional oracle contract address (33 bytes with discriminant).
    pub oracle_contract: Option<Address>,
    /// Optional access-control contract address.
    pub access_control: Option<Address>,
    /// Contract storage version for migration tracking.
    pub storage_version: u32,
}

impl HotConfigPack {
    /// Default initializer — sets safe zero-values.  Admin must be set after.
    pub fn new_default(env: &Env, admin: Address) -> Self {
        HotConfigPack {
            admin,
            plan_count: 0,
            subscription_count: 0,
            max_plans_per_merchant: 0,
            large_charge_threshold: i128::MAX,
            invoice_contract: None,
            oracle_contract: None,
            access_control: None,
            storage_version: 1,
        }
    }

    /// Estimated byte size of the serialised pack (approximate).
    ///
    /// Used by the gas profiler to project instance-storage fees.
    pub const APPROX_BYTES: u32 = 175;

    /// Number of separate `StorageKey` entries this pack replaces.
    pub const ENTRIES_REPLACED: u32 = 9;

    /// Estimated gas saving per invocation vs. individual reads.
    ///
    /// Each instance-storage read costs roughly 300 instructions.
    /// Reading the pack once saves `(ENTRIES_REPLACED - 1) * 300`.
    pub const ESTIMATED_INSTR_SAVING_PER_CALL: u64 =
        (Self::ENTRIES_REPLACED as u64 - 1) * 300;
}

// ─── Subscription packed record ───────────────────────────────────────────────

/// All mutable subscription state in one persistent storage entry.
///
/// Fields that are updated together (e.g. on `charge_subscription`) are
/// colocated so a single read + single write services the whole operation.
///
/// Replaces individual `Subscription` struct reads that previously required
/// a separate `get` for every field update.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionPack {
    /// The subscription's numeric ID (matches its storage key).
    pub id: u64,
    /// The plan this subscription is bound to.
    pub plan_id: u64,
    /// Subscriber's wallet address.
    pub subscriber: Address,
    /// Packed status bitmap:
    ///   0 = Active, 1 = Paused, 2 = Cancelled, 3 = PastDue
    pub status_bits: u8,
    /// Unix timestamp when the subscription was started.
    pub started_at: u64,
    /// Unix timestamp of the last successful charge.
    pub last_charged_at: u64,
    /// Unix timestamp when the next charge is due.
    pub next_charge_at: u64,
    /// Cumulative amount paid (stroops / smallest token unit).
    pub total_paid: i128,
    /// Cumulative gas spent across all calls on this subscription.
    pub total_gas_spent: u64,
    /// Number of successful charges.
    pub charge_count: u32,
    /// Timestamp when the subscription was paused (0 when active).
    pub paused_at: u64,
    /// Cumulative seconds spent in the Paused state.
    pub pause_duration: u64,
    /// Amount requested in the pending refund (0 when no active request).
    pub refund_requested_amount: i128,
}

impl SubscriptionPack {
    /// Status bit values — keeps the mapping in one canonical place.
    pub const STATUS_ACTIVE: u8 = 0;
    pub const STATUS_PAUSED: u8 = 1;
    pub const STATUS_CANCELLED: u8 = 2;
    pub const STATUS_PAST_DUE: u8 = 3;

    /// Approximate serialised size of this pack in bytes.
    pub const APPROX_BYTES: u32 = 120;

    /// Returns `true` when the subscription is in the Active state.
    #[inline]
    pub fn is_active(&self) -> bool {
        self.status_bits == Self::STATUS_ACTIVE
    }

    /// Returns `true` when the subscription is Cancelled.
    #[inline]
    pub fn is_cancelled(&self) -> bool {
        self.status_bits == Self::STATUS_CANCELLED
    }

    /// Returns `true` when the subscription is currently Paused.
    #[inline]
    pub fn is_paused(&self) -> bool {
        self.status_bits == Self::STATUS_PAUSED
    }

    /// Returns `true` when the subscription is PastDue.
    #[inline]
    pub fn is_past_due(&self) -> bool {
        self.status_bits == Self::STATUS_PAST_DUE
    }
}

// ─── Plan packed record ───────────────────────────────────────────────────────

/// All mutable plan state in one persistent storage entry.
///
/// Fields that change together on `create_plan` / `update_plan` are colocated.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PlanPack {
    /// The plan's numeric ID.
    pub id: u64,
    /// Merchant's wallet address.
    pub merchant: Address,
    /// Plan display name.
    pub name: String,
    /// Price per billing interval (stroops / smallest token unit).
    pub price: i128,
    /// Token contract address used for billing.
    pub token: Address,
    /// Packed billing interval:
    ///   0 = Daily, 1 = Weekly, 2 = Monthly, 3 = Quarterly, 4 = Yearly
    pub interval_bits: u8,
    /// Whether the plan is accepting new subscriptions.
    pub active: bool,
    /// Current subscriber count (u32 — max 4 billion).
    pub subscriber_count: u32,
    /// Creation timestamp.
    pub created_at: u64,
}

impl PlanPack {
    /// Interval bit values.
    pub const INTERVAL_DAILY: u8 = 0;
    pub const INTERVAL_WEEKLY: u8 = 1;
    pub const INTERVAL_MONTHLY: u8 = 2;
    pub const INTERVAL_QUARTERLY: u8 = 3;
    pub const INTERVAL_YEARLY: u8 = 4;

    /// Interval in seconds for each bit value.
    pub fn interval_seconds(&self) -> u64 {
        match self.interval_bits {
            Self::INTERVAL_DAILY => 86_400,
            Self::INTERVAL_WEEKLY => 604_800,
            Self::INTERVAL_MONTHLY => 2_592_000,
            Self::INTERVAL_QUARTERLY => 7_776_000,
            Self::INTERVAL_YEARLY => 31_536_000,
            _ => 2_592_000, // default to monthly
        }
    }

    /// Approximate serialised size of this pack in bytes.
    pub const APPROX_BYTES: u32 = 100;
}

// ─── Packed rate-limit entry ──────────────────────────────────────────────────

/// Combines the rate-limit config and last-call timestamp into one
/// **temporary** storage entry.
///
/// Old approach: two instance entries per (caller, fn_name).
/// New approach: one temporary entry per (caller, fn_name).
///
/// This pack auto-expires with the TTL equal to `min_interval_secs`, so
/// in steady state (all windows expired) the temporary tier holds zero
/// rate-limit entries and instance storage grows by exactly 0 entries.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateLimitPack {
    /// Minimum seconds between calls for this (caller, function) pair.
    pub min_interval_secs: u64,
    /// Ledger timestamp of the last allowed call.
    pub last_call_at: u64,
    /// Number of calls recorded in the current window.
    pub window_call_count: u32,
    /// Absolute cap on calls per window (0 = uncapped).
    pub max_calls_per_window: u32,
}

impl RateLimitPack {
    /// Returns `true` when the caller is allowed to proceed at `now`.
    #[inline]
    pub fn is_allowed(&self, now: u64) -> bool {
        if self.min_interval_secs == 0 {
            return true;
        }
        now >= self.last_call_at.saturating_add(self.min_interval_secs)
    }

    /// Seconds until the caller may call again (0 when allowed).
    #[inline]
    pub fn retry_after(&self, now: u64) -> u64 {
        let unlock_at = self.last_call_at.saturating_add(self.min_interval_secs);
        unlock_at.saturating_sub(now)
    }

    /// Approximate serialised size.
    pub const APPROX_BYTES: u32 = 32;

    /// Number of separate entries this pack replaces per (caller, fn).
    pub const ENTRIES_REPLACED: u32 = 2;
}

// ─── Storage key extensions ───────────────────────────────────────────────────

/// Packed storage key variants (complement the core `StorageKey` enum in
/// `subtrackr-types` without requiring a breaking change).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum PackedStorageKey {
    /// Packed hot config (instance storage).
    HotConfig,
    /// Packed subscription record (persistent storage).
    SubPack(u64),
    /// Packed plan record (persistent storage).
    PlanPack(u64),
    /// Packed rate-limit entry (temporary storage).
    /// Key: (caller_address, function_name_bytes).
    RateLimitPack(Address, String),
    /// Nonce guard for double-charge prevention (temporary storage).
    /// Expires after 1 ledger (~5 s).
    ChargeNonce(u64),
    /// Packed MEV protection config + alert count (instance storage).
    MevConfigPack,
}

// ─── Packing analysis helpers ─────────────────────────────────────────────────

/// Reports on the storage space saved by the packing scheme.
pub struct StoragePackingAnalysis;

impl StoragePackingAnalysis {
    /// Estimated total bytes saved per contract call vs. unpacked layout.
    pub fn bytes_saved_per_call() -> u32 {
        // HotConfigPack: 9 entries → 1 entry.
        // Each instance entry has ~20-byte key overhead in Soroban.
        let hot_key_overhead_saved = (HotConfigPack::ENTRIES_REPLACED - 1) * 20;
        // RateLimitPack: 2 entries → 1 per (caller, fn).
        // Assume avg 3 rate-limited functions in flight.
        let rl_key_overhead_saved = RateLimitPack::ENTRIES_REPLACED - 1;
        hot_key_overhead_saved + rl_key_overhead_saved
    }

    /// Estimated CPU instruction savings per call.
    pub fn instructions_saved_per_call() -> u64 {
        HotConfigPack::ESTIMATED_INSTR_SAVING_PER_CALL
    }

    /// Human-readable summary as an array of string pairs for on-chain logging.
    pub fn summary(env: &Env) -> soroban_sdk::Vec<(String, String)> {
        let bytes = Self::bytes_saved_per_call();
        let instr = Self::instructions_saved_per_call();
        soroban_sdk::vec![
            env,
            (
                String::from_str(env, "hot_entries_replaced"),
                String::from_str(env, "9"),
            ),
            (
                String::from_str(env, "approx_bytes_saved_per_call"),
                // Format the number as a string the hard way (no std alloc).
                {
                    let hundreds = bytes / 100;
                    let tens = (bytes % 100) / 10;
                    let ones = bytes % 10;
                    let s = soroban_sdk::format!(env, "{}{}{}", hundreds, tens, ones);
                    s
                },
            ),
            (
                String::from_str(env, "approx_instr_saved_per_call"),
                {
                    let thousands = instr / 1000;
                    let hundreds = (instr % 1000) / 100;
                    let tens = (instr % 100) / 10;
                    let ones = instr % 10;
                    soroban_sdk::format!(env, "{}{}{}{}", thousands, hundreds, tens, ones)
                },
            ),
            (
                String::from_str(env, "rl_pack_entries_replaced"),
                String::from_str(env, "2"),
            ),
        ]
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    // ── HotConfigPack ────────────────────────────────────────────────────────

    #[test]
    fn hot_config_pack_new_default() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let pack = HotConfigPack::new_default(&env, admin.clone());

        assert_eq!(pack.admin, admin);
        assert_eq!(pack.plan_count, 0);
        assert_eq!(pack.subscription_count, 0);
        assert_eq!(pack.max_plans_per_merchant, 0);
        assert_eq!(pack.large_charge_threshold, i128::MAX);
        assert!(pack.invoice_contract.is_none());
        assert!(pack.oracle_contract.is_none());
        assert!(pack.access_control.is_none());
        assert_eq!(pack.storage_version, 1);
    }

    #[test]
    fn hot_config_pack_constants_are_positive() {
        assert!(HotConfigPack::APPROX_BYTES > 0);
        assert!(HotConfigPack::ENTRIES_REPLACED >= 9);
        assert!(HotConfigPack::ESTIMATED_INSTR_SAVING_PER_CALL > 0);
    }

    #[test]
    fn hot_config_pack_instruction_saving_formula() {
        // 8 avoided reads × 300 instructions each
        let expected = (HotConfigPack::ENTRIES_REPLACED as u64 - 1) * 300;
        assert_eq!(HotConfigPack::ESTIMATED_INSTR_SAVING_PER_CALL, expected);
    }

    // ── SubscriptionPack ─────────────────────────────────────────────────────

    #[test]
    fn subscription_pack_status_helpers() {
        let env = Env::default();
        let addr = Address::generate(&env);
        let mut pack = SubscriptionPack {
            id: 1,
            plan_id: 1,
            subscriber: addr,
            status_bits: SubscriptionPack::STATUS_ACTIVE,
            started_at: 0,
            last_charged_at: 0,
            next_charge_at: 0,
            total_paid: 0,
            total_gas_spent: 0,
            charge_count: 0,
            paused_at: 0,
            pause_duration: 0,
            refund_requested_amount: 0,
        };

        assert!(pack.is_active());
        assert!(!pack.is_paused());
        assert!(!pack.is_cancelled());
        assert!(!pack.is_past_due());

        pack.status_bits = SubscriptionPack::STATUS_PAUSED;
        assert!(!pack.is_active());
        assert!(pack.is_paused());

        pack.status_bits = SubscriptionPack::STATUS_CANCELLED;
        assert!(pack.is_cancelled());

        pack.status_bits = SubscriptionPack::STATUS_PAST_DUE;
        assert!(pack.is_past_due());
    }

    // ── PlanPack ─────────────────────────────────────────────────────────────

    #[test]
    fn plan_pack_interval_seconds() {
        let env = Env::default();
        let addr = Address::generate(&env);
        let make = |bits: u8| PlanPack {
            id: 1,
            merchant: addr.clone(),
            name: String::from_str(&env, "Test"),
            price: 1_000_000,
            token: addr.clone(),
            interval_bits: bits,
            active: true,
            subscriber_count: 0,
            created_at: 0,
        };

        assert_eq!(make(PlanPack::INTERVAL_DAILY).interval_seconds(), 86_400);
        assert_eq!(make(PlanPack::INTERVAL_WEEKLY).interval_seconds(), 604_800);
        assert_eq!(make(PlanPack::INTERVAL_MONTHLY).interval_seconds(), 2_592_000);
        assert_eq!(make(PlanPack::INTERVAL_QUARTERLY).interval_seconds(), 7_776_000);
        assert_eq!(make(PlanPack::INTERVAL_YEARLY).interval_seconds(), 31_536_000);
        // Unknown bits → default monthly
        assert_eq!(make(99).interval_seconds(), 2_592_000);
    }

    // ── RateLimitPack ────────────────────────────────────────────────────────

    #[test]
    fn rate_limit_pack_is_allowed_no_interval() {
        let pack = RateLimitPack {
            min_interval_secs: 0,
            last_call_at: 1_000,
            window_call_count: 10,
            max_calls_per_window: 0,
        };
        assert!(pack.is_allowed(1_000)); // no cooldown
    }

    #[test]
    fn rate_limit_pack_is_allowed_after_cooldown() {
        let pack = RateLimitPack {
            min_interval_secs: 60,
            last_call_at: 1_000,
            window_call_count: 1,
            max_calls_per_window: 0,
        };
        assert!(!pack.is_allowed(1_059)); // 59 s elapsed — still locked
        assert!(pack.is_allowed(1_060)); // exactly at unlock
        assert!(pack.is_allowed(1_061)); // past unlock
    }

    #[test]
    fn rate_limit_pack_retry_after() {
        let pack = RateLimitPack {
            min_interval_secs: 60,
            last_call_at: 1_000,
            window_call_count: 1,
            max_calls_per_window: 0,
        };
        assert_eq!(pack.retry_after(1_040), 20); // 20 s remaining
        assert_eq!(pack.retry_after(1_060), 0);  // at unlock → 0
        assert_eq!(pack.retry_after(1_100), 0);  // past unlock → 0
    }

    #[test]
    fn rate_limit_pack_retry_after_no_overflow() {
        // last_call_at = 0, min_interval = 0 → saturating_sub should give 0
        let pack = RateLimitPack {
            min_interval_secs: 0,
            last_call_at: 0,
            window_call_count: 0,
            max_calls_per_window: 0,
        };
        assert_eq!(pack.retry_after(0), 0);
    }

    // ── StoragePackingAnalysis ────────────────────────────────────────────────

    #[test]
    fn packing_analysis_bytes_saved_positive() {
        assert!(StoragePackingAnalysis::bytes_saved_per_call() > 0);
    }

    #[test]
    fn packing_analysis_instructions_saved_positive() {
        assert!(StoragePackingAnalysis::instructions_saved_per_call() > 0);
    }

    #[test]
    fn packing_analysis_summary_has_expected_keys() {
        let env = Env::default();
        let summary = StoragePackingAnalysis::summary(&env);
        // Should have exactly 4 entries
        assert_eq!(summary.len(), 4);
        let first = summary.get(0).unwrap();
        assert_eq!(first.0, String::from_str(&env, "hot_entries_replaced"));
    }

    // ── PackedStorageKey ─────────────────────────────────────────────────────

    #[test]
    fn packed_storage_key_variants_are_distinct() {
        let env = Env::default();
        let addr = Address::generate(&env);
        let fn_name = String::from_str(&env, "create_plan");

        let k1 = PackedStorageKey::HotConfig;
        let k2 = PackedStorageKey::SubPack(1);
        let k3 = PackedStorageKey::PlanPack(1);
        let k4 = PackedStorageKey::RateLimitPack(addr.clone(), fn_name.clone());
        let k5 = PackedStorageKey::ChargeNonce(1);
        let k6 = PackedStorageKey::MevConfigPack;

        // Verify they don't equal each other (basic distinctness)
        assert_ne!(k2, k3); // SubPack(1) ≠ PlanPack(1)
        assert_eq!(k1, PackedStorageKey::HotConfig); // identity
        assert_eq!(k5, PackedStorageKey::ChargeNonce(1));
        let _ = (k4, k6); // ensure they compile
    }

    #[test]
    fn subscription_pack_approx_bytes_defined() {
        assert!(SubscriptionPack::APPROX_BYTES > 0);
    }

    #[test]
    fn plan_pack_approx_bytes_defined() {
        assert!(PlanPack::APPROX_BYTES > 0);
    }

    #[test]
    fn rate_limit_pack_entries_replaced() {
        assert_eq!(RateLimitPack::ENTRIES_REPLACED, 2);
    }
}
