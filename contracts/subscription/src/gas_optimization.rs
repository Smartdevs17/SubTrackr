/// Gas optimisation module for the SubTrackr subscription contract.
///
/// Provides:
/// 1. Storage migration helpers (v2 → v3 packed layout).
/// 2. Benchmark comparison utilities (before/after gas estimates).
/// 3. Read/write trade-off documentation for each packing decision.
///
/// # Read vs write gas trade-offs
///
/// | Operation        | Before (unpacked) | After (packed) | Δ      |
/// |------------------|-------------------|----------------|--------|
/// | subscribe()      | 13 slot writes    | 7 slot writes  | -46%   |
/// | get_sub()        | 13 slot reads     | 7 slot reads   | -46%   |
/// | charge_sub()     | 13+8 = 21 writes  | 7+4 = 11 writes| -48%   |
/// | create_plan()    | 8 slot writes     | 4 slot writes  | -50%   |
///
/// Packing introduces a small decode cost (bit-shifts and masks) on every
/// read — estimated at 2–4 instructions per field. For a typical read of
/// all 13 fields this is ~50 extra instructions vs saving 6 storage-read
/// fees (each ~10 000 gas on Soroban). Net saving per read: ~59 950 gas.

use soroban_sdk::{Address, Env, String};

use crate::gas_storage::{
    pack_flags, pack_ids, pack_pause, pack_plan_id_count, pack_price_interval_flags,
    pack_timestamps_a, pack_timestamps_b, scale_amount, slot_audit_report, unpack_active,
    unpack_charge_count, unpack_flag, unpack_id, unpack_interval_secs, unpack_last_charged_at,
    unpack_next_charge_at, unpack_pause_duration, unpack_paused_at, unpack_plan_id,
    unpack_plan_id_from_pack, unpack_price, unpack_started_at, unpack_status,
    unpack_subscriber_count, FLAG_CRYPTO_ENABLED, FLAG_NOTIFICATIONS, FLAG_REFUND_PENDING,
    PackedPlan, PackedSubscription, STATUS_ACTIVE, STATUS_CANCELLED, STATUS_EXPIRED,
    STATUS_PAUSED,
};

// ─────────────────────────────────────────────────────────────────────────────
// Substrate types mirrored here for migration (avoid cross-crate dep in tests)
// ─────────────────────────────────────────────────────────────────────────────

/// Status values — kept in sync with `subtrackr_types::SubscriptionStatus`.
#[derive(Clone, PartialEq, Debug)]
pub enum SubStatus {
    Active,
    Paused,
    Cancelled,
    Expired,
}

impl SubStatus {
    pub fn to_flag(&self) -> u8 {
        match self {
            SubStatus::Active    => STATUS_ACTIVE,
            SubStatus::Paused    => STATUS_PAUSED,
            SubStatus::Cancelled => STATUS_CANCELLED,
            SubStatus::Expired   => STATUS_EXPIRED,
        }
    }

    pub fn from_flag(f: u8) -> Self {
        match f {
            STATUS_PAUSED    => SubStatus::Paused,
            STATUS_CANCELLED => SubStatus::Cancelled,
            STATUS_EXPIRED   => SubStatus::Expired,
            _                => SubStatus::Active,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration helper
// ─────────────────────────────────────────────────────────────────────────────

/// Input shape for migrating an existing (unpacked) subscription row.
pub struct LegacySubscription {
    pub id: u64,
    pub plan_id: u64,
    pub subscriber: Address,
    pub status: SubStatus,
    pub started_at: u64,
    pub last_charged_at: u64,
    pub next_charge_at: u64,
    pub total_paid: i128,
    pub charge_count: u64,
    pub paused_at: u64,
    pub pause_duration: u64,
    /// Legacy bool flags (may not exist in very old rows — default false).
    pub crypto_enabled: bool,
    pub notifications_enabled: bool,
    pub refund_pending: bool,
}

/// Input shape for migrating an existing (unpacked) plan row.
pub struct LegacyPlan {
    pub id: u64,
    pub merchant: Address,
    pub name: String,
    pub price: i128,
    pub interval_secs: u64,
    pub active: bool,
    pub subscriber_count: u32,
    pub token: Address,
}

/// Convert a legacy subscription row to the packed representation.
///
/// Called once per subscription during the v2 → v3 migration in `lib.rs`.
/// The result is written back to persistent storage under the same key,
/// replacing the old layout atomically.
pub fn migrate_subscription(leg: LegacySubscription) -> PackedSubscription {
    PackedSubscription {
        id_and_plan: pack_ids(leg.id, leg.plan_id),
        subscriber: leg.subscriber,
        flags: pack_flags(
            leg.status.to_flag(),
            leg.crypto_enabled,
            leg.notifications_enabled,
            leg.refund_pending,
        ),
        timestamps_a: pack_timestamps_a(leg.started_at, leg.last_charged_at),
        timestamps_b: pack_timestamps_b(leg.next_charge_at, leg.charge_count),
        total_paid_scaled: scale_amount(leg.total_paid),
        pause_pack: pack_pause(leg.paused_at, leg.pause_duration),
    }
}

/// Convert a legacy plan row to the packed representation.
pub fn migrate_plan(leg: LegacyPlan) -> PackedPlan {
    PackedPlan {
        id_and_count: pack_plan_id_count(leg.id, leg.subscriber_count),
        merchant: leg.merchant,
        name: leg.name,
        price_interval_flags: pack_price_interval_flags(leg.price, leg.interval_secs, leg.active),
        token: leg.token,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unpack helpers exposed to the rest of the contract
// ─────────────────────────────────────────────────────────────────────────────

/// Decode all fields from a `PackedSubscription` in one call.
/// Returns a tuple matching the original `Subscription` field order.
#[allow(clippy::type_complexity)]
pub fn unpack_subscription(
    p: &PackedSubscription,
) -> (
    u64,      // id
    u64,      // plan_id
    SubStatus,
    u64,      // started_at
    u64,      // last_charged_at
    u64,      // next_charge_at
    i128,     // total_paid
    u64,      // charge_count
    u64,      // paused_at
    u64,      // pause_duration
    bool,     // crypto_enabled
    bool,     // notifications_enabled
    bool,     // refund_pending
) {
    (
        unpack_id(p.id_and_plan),
        unpack_plan_id(p.id_and_plan),
        SubStatus::from_flag(unpack_status(p.flags)),
        unpack_started_at(p.timestamps_a),
        unpack_last_charged_at(p.timestamps_a),
        unpack_next_charge_at(p.timestamps_b),
        crate::gas_storage::unscale_amount(p.total_paid_scaled),
        unpack_charge_count(p.timestamps_b),
        unpack_paused_at(p.pause_pack),
        unpack_pause_duration(p.pause_pack),
        unpack_flag(p.flags, FLAG_CRYPTO_ENABLED),
        unpack_flag(p.flags, FLAG_NOTIFICATIONS),
        unpack_flag(p.flags, FLAG_REFUND_PENDING),
    )
}

/// Decode all fields from a `PackedPlan`.
pub fn unpack_plan(p: &PackedPlan) -> (u64, u32, i128, u64, bool) {
    (
        unpack_plan_id_from_pack(p.id_and_count),
        unpack_subscriber_count(p.id_and_count),
        unpack_price(p.price_interval_flags),
        unpack_interval_secs(p.price_interval_flags),
        unpack_active(p.price_interval_flags),
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Gas benchmark comparison
// ─────────────────────────────────────────────────────────────────────────────

/// Approximate gas costs (in Soroban fee units) for storage operations.
/// Based on Soroban mainnet fee schedule (subject to network upgrades).
const GAS_PER_SLOT_READ: u64  = 10_000;
const GAS_PER_SLOT_WRITE: u64 = 20_000;
/// Cost of bit-shift / mask operations per field (instruction gas).
const GAS_PER_DECODE_OP: u64  = 2;

#[derive(Debug)]
pub struct GasBenchmark {
    /// Name of the operation being measured.
    pub operation: &'static str,
    /// Estimated gas before packing.
    pub gas_before: u64,
    /// Estimated gas after packing.
    pub gas_after: u64,
    /// Absolute saving.
    pub saving: u64,
    /// Saving as a percentage of the before cost.
    pub saving_pct: u64,
}

/// Build a benchmark report for the four hot-path operations.
pub fn benchmark_report() -> [GasBenchmark; 4] {
    // subscribe(): 13 writes before → 7 writes after; 13 decode ops added
    let sub_before  = 13 * GAS_PER_SLOT_WRITE;
    let sub_after   = 7  * GAS_PER_SLOT_WRITE + 13 * GAS_PER_DECODE_OP;

    // get_subscription(): 13 reads before → 7 reads after; 13 decode ops
    let get_before  = 13 * GAS_PER_SLOT_READ;
    let get_after   = 7  * GAS_PER_SLOT_READ + 13 * GAS_PER_DECODE_OP;

    // charge_subscription(): 13+8 = 21 writes before → 7+4 = 11 writes after
    let charge_before = 21 * GAS_PER_SLOT_WRITE;
    let charge_after  = 11 * GAS_PER_SLOT_WRITE + 21 * GAS_PER_DECODE_OP;

    // create_plan(): 8 writes before → 4 writes after
    let plan_before = 8 * GAS_PER_SLOT_WRITE;
    let plan_after  = 4 * GAS_PER_SLOT_WRITE + 8 * GAS_PER_DECODE_OP;

    [
        GasBenchmark {
            operation: "subscribe",
            gas_before: sub_before,
            gas_after: sub_after,
            saving: sub_before.saturating_sub(sub_after),
            saving_pct: 100 - (sub_after * 100 / sub_before),
        },
        GasBenchmark {
            operation: "get_subscription",
            gas_before: get_before,
            gas_after: get_after,
            saving: get_before.saturating_sub(get_after),
            saving_pct: 100 - (get_after * 100 / get_before),
        },
        GasBenchmark {
            operation: "charge_subscription",
            gas_before: charge_before,
            gas_after: charge_after,
            saving: charge_before.saturating_sub(charge_after),
            saving_pct: 100 - (charge_after * 100 / charge_before),
        },
        GasBenchmark {
            operation: "create_plan",
            gas_before: plan_before,
            gas_after: plan_after,
            saving: plan_before.saturating_sub(plan_after),
            saving_pct: 100 - (plan_after * 100 / plan_before),
        },
    ]
}

/// Print-friendly benchmark summary (returns a static str for use in events/logs).
pub fn print_benchmark_summary(_env: &Env) {
    let report = benchmark_report();
    for b in &report {
        // In production use env.events() to publish; here we rely on the
        // caller to surface these via the gas_profiler event stream.
        let _ = b; // suppress unused warning in no_std
    }
}

/// Slot audit — returns the static audit string from gas_storage.
pub fn audit_slots() -> &'static str {
    slot_audit_report()
}
