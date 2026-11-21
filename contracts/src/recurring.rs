#![no_std]
// TODO: migrate `env.events().publish(..)` to the `#[contractevent]` macro.
// soroban-sdk 28 deprecated the imperative form; it is still functional and
// still emits identical events, so the deprecation is allowed crate-wide
// until the event payloads are reworked. CI lints with `-D warnings`.
#![allow(deprecated)]
//! SubTrackr recurring-charge contract with calendar-aware billing cycles.
//!
//! A payer authorises a [`Schedule`]: pay `amount` of `token` to `merchant`
//! every `count` days, weeks, months or years. Anyone (typically an off-chain
//! keeper) may call [`RecurringCharges::charge`] once a cycle is due; the
//! contract pulls the funds with `transfer_from`, so the payer must first
//! `approve` this contract as a spender on the token.
//!
//! # Calendar-aware cycles
//!
//! Every due date is derived from the schedule's original start timestamp
//! (the *anchor*) rather than from the previous due date, so cycles never
//! drift:
//!
//! * Monthly and yearly cycles land on the anchor's day of month, clamped to
//!   the last day of shorter months. A schedule anchored on Jan 31 is due on
//!   Feb 28 (Feb 29 in leap years), Mar 31, Apr 30, and so on.
//! * A Feb 29 yearly anchor is due on Feb 28 in non-leap years.
//! * The anchor's time of day (UTC) is preserved on every cycle.
//! * Daily and weekly cycles are exact multiples of 86 400 / 604 800 seconds.
//!
//! # Failure handling
//!
//! * A charge whose payer lacks balance or allowance does **not** revert: the
//!   attempt is recorded, a `failed` event is emitted and the next retry is
//!   allowed after [`RETRY_DELAY_SECS`]. After [`MAX_FAILED_ATTEMPTS`]
//!   consecutive failures the schedule becomes [`ScheduleStatus::Lapsed`].
//! * Each due cycle is charged at most once. A keeper that falls behind
//!   charges overdue cycles one call at a time.
//! * Cycles that come due while a schedule is paused or lapsed are skipped,
//!   not back-charged: resuming moves to the first due date at or after the
//!   resume time.
//!
//! # Observability
//!
//! Every state change publishes an event under the `recurring` topic
//! (`created`, `charged`, `failed`, `lapsed`, `paused`, `resumed`,
//! `cancelled`, `completed`) with the schedule id as the second topic, so
//! indexers can follow a schedule's whole lifecycle.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol,
    Vec,
};

/// Consecutive failed charge attempts before a schedule lapses.
pub const MAX_FAILED_ATTEMPTS: u32 = 3;
/// Minimum wait between failed charge attempts (one day).
pub const RETRY_DELAY_SECS: u64 = 86_400;
/// Upper bound on [`Cycle::count`] (e.g. at most every 1 000 months).
pub const MAX_CYCLE_COUNT: u32 = 1_000;
/// Upper bound on the number of dates [`RecurringCharges::preview_due_dates`]
/// returns in one call.
pub const MAX_PREVIEW: u32 = 24;

const SECS_PER_DAY: u64 = 86_400;
const SECS_PER_WEEK: u64 = 604_800;

/// Ledgers per day at a ~5 s close time.
const DAY_IN_LEDGERS: u32 = 17_280;
/// Schedule entries are re-extended once their TTL drops below this.
const TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
/// ...and extended to this. Any interaction with a schedule bumps its TTL.
const TTL_EXTEND_TO: u32 = 120 * DAY_IN_LEDGERS;

const TOPIC: Symbol = symbol_short!("recurring");

// ════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════

#[contracterror]
#[derive(Clone, Debug, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum RecurringError {
    /// No schedule exists with the given id.
    NotFound = 1,
    /// `amount` must be strictly positive.
    InvalidAmount = 2,
    /// `count` must be between 1 and [`MAX_CYCLE_COUNT`].
    InvalidCycle = 3,
    /// The requested start time is in the past.
    InvalidStart = 4,
    /// The next cycle (or retry) is not due yet.
    NotDue = 5,
    /// The schedule is not in a state that allows this operation.
    InvalidState = 6,
    /// The caller is neither the payer nor the merchant.
    Unauthorized = 7,
    /// A due date would overflow the timestamp range.
    Overflow = 8,
    /// Preview limit must be between 1 and [`MAX_PREVIEW`].
    InvalidLimit = 9,
    /// Payer and merchant must be different accounts.
    InvalidParties = 10,
}

/// Calendar unit a cycle is measured in.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CycleUnit {
    Day,
    Week,
    Month,
    Year,
}

/// A billing cycle: every `count` `unit`s (e.g. every 3 months).
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cycle {
    pub unit: CycleUnit,
    pub count: u32,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScheduleStatus {
    /// Charges are collected as cycles come due.
    Active,
    /// Paused by the payer; due dates are skipped until resumed.
    Paused,
    /// Stopped after [`MAX_FAILED_ATTEMPTS`] failed charges; payer may resume.
    Lapsed,
    /// Cancelled by payer or merchant. Final.
    Cancelled,
    /// `max_cycles` charges were collected. Final.
    Completed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Schedule {
    pub id: u64,
    pub payer: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub cycle: Cycle,
    /// Anchor timestamp; cycle `k` is due at `anchor + k cycles`.
    pub anchor: u64,
    /// Total charges to collect; `0` means unlimited.
    pub max_cycles: u32,
    /// Charges collected so far.
    pub charges: u32,
    /// Index `k` of the next cycle to charge.
    pub next_cycle: u32,
    /// Due timestamp of `next_cycle`.
    pub next_due: u64,
    /// Earliest timestamp the next charge attempt is accepted (later than
    /// `next_due` after a failed attempt).
    pub next_attempt_at: u64,
    /// Consecutive failed attempts for the current cycle.
    pub failed_attempts: u32,
    /// Timestamp of the last successful charge; `0` if none yet.
    pub last_charged_at: u64,
    pub status: ScheduleStatus,
}

/// Result of a [`RecurringCharges::charge`] call that did not error.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChargeOutcome {
    /// Funds moved for the cycle with this index.
    Charged(u32),
    /// Payer lacked balance or allowance; holds the consecutive failure count.
    Failed(u32),
    /// This failure lapsed the schedule.
    Lapsed,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    NextId,
    Schedule(u64),
}

// ════════════════════════════════════════════════════════════════
// CALENDAR MATH (proleptic Gregorian, UTC)
// ════════════════════════════════════════════════════════════════

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = ((month + 9) % 12) as i64;
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Civil date `(year, month, day)` for a day count since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        2 if is_leap_year(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// `(year * 12 + month - 1)` for a timestamp: a month index that subtracts
/// cleanly across year boundaries.
fn month_index(ts: u64) -> i64 {
    let (y, m, _) = civil_from_days((ts / SECS_PER_DAY) as i64);
    y * 12 + (m as i64 - 1)
}

/// Adds `months` calendar months to `ts`, clamping the day of month to the
/// target month's length and preserving the time of day.
fn add_months(ts: u64, months: u64) -> Option<u64> {
    let secs_of_day = ts % SECS_PER_DAY;
    let (y, m, d) = civil_from_days((ts / SECS_PER_DAY) as i64);
    let total = (y * 12 + (m as i64 - 1)).checked_add(i64::try_from(months).ok()?)?;
    let year = total.div_euclid(12);
    let month = (total.rem_euclid(12) + 1) as u32;
    let day = d.min(days_in_month(year, month));
    let days = u64::try_from(days_from_civil(year, month, day)).ok()?;
    days.checked_mul(SECS_PER_DAY)?.checked_add(secs_of_day)
}

/// Length of one cycle in calendar months, for month/year units.
fn months_per_cycle(cycle: &Cycle) -> Option<u64> {
    match cycle.unit {
        CycleUnit::Month => Some(cycle.count as u64),
        CycleUnit::Year => Some(cycle.count as u64 * 12),
        CycleUnit::Day | CycleUnit::Week => None,
    }
}

/// Length of one cycle in seconds, for day/week units.
fn secs_per_cycle(cycle: &Cycle) -> Option<u64> {
    match cycle.unit {
        CycleUnit::Day => Some(cycle.count as u64 * SECS_PER_DAY),
        CycleUnit::Week => Some(cycle.count as u64 * SECS_PER_WEEK),
        CycleUnit::Month | CycleUnit::Year => None,
    }
}

/// Due timestamp of cycle `k` for a schedule anchored at `anchor`.
fn due_at(anchor: u64, cycle: &Cycle, k: u32) -> Option<u64> {
    match secs_per_cycle(cycle) {
        Some(period) => anchor.checked_add(period.checked_mul(k as u64)?),
        None => add_months(anchor, months_per_cycle(cycle)?.checked_mul(k as u64)?),
    }
}

/// Smallest cycle index `k >= min_k` whose due date is at or after `now`.
fn first_cycle_at_or_after(anchor: u64, cycle: &Cycle, now: u64, min_k: u32) -> Option<u32> {
    if due_at(anchor, cycle, min_k)? >= now {
        return Some(min_k);
    }
    // Estimate k directly, then correct by at most a couple of steps; this
    // keeps the cost constant however long the schedule was inactive.
    let estimate = match secs_per_cycle(cycle) {
        Some(period) => (now - anchor) / period,
        None => {
            let months = (month_index(now) - month_index(anchor)).max(0) as u64;
            months / months_per_cycle(cycle)?
        }
    };
    let mut k = u32::try_from(estimate).ok()?.max(min_k);
    while due_at(anchor, cycle, k)? < now {
        k = k.checked_add(1)?;
    }
    Some(k)
}

// ════════════════════════════════════════════════════════════════
// CONTRACT
// ════════════════════════════════════════════════════════════════

#[contract]
pub struct RecurringCharges;

#[contractimpl]
impl RecurringCharges {
    /// Creates a schedule and returns its id. Requires the payer's auth.
    ///
    /// The first cycle is due at `start` (or now when `None`). `max_cycles`
    /// caps the number of charges; `0` means unlimited. Before the first
    /// charge, the payer must `approve` this contract on `token` for at least
    /// `amount` (or the total they intend to allow).
    pub fn create_schedule(
        env: Env,
        payer: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        cycle: Cycle,
        start: Option<u64>,
        max_cycles: u32,
    ) -> Result<u64, RecurringError> {
        payer.require_auth();
        if amount <= 0 {
            return Err(RecurringError::InvalidAmount);
        }
        if cycle.count == 0 || cycle.count > MAX_CYCLE_COUNT {
            return Err(RecurringError::InvalidCycle);
        }
        if payer == merchant {
            return Err(RecurringError::InvalidParties);
        }
        let now = env.ledger().timestamp();
        let anchor = start.unwrap_or(now);
        if anchor < now {
            return Err(RecurringError::InvalidStart);
        }
        // Reject schedules whose second cycle already overflows, so `charge`
        // can never be blocked by an unrepresentable due date at cycle 1.
        due_at(anchor, &cycle, 1).ok_or(RecurringError::Overflow)?;

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(0u64)
            + 1;
        env.storage().instance().set(&DataKey::NextId, &id);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        let schedule = Schedule {
            id,
            payer: payer.clone(),
            merchant: merchant.clone(),
            token,
            amount,
            cycle,
            anchor,
            max_cycles,
            charges: 0,
            next_cycle: 0,
            next_due: anchor,
            next_attempt_at: anchor,
            failed_attempts: 0,
            last_charged_at: 0,
            status: ScheduleStatus::Active,
        };
        save(&env, &schedule);
        env.events().publish(
            (TOPIC, symbol_short!("created"), id),
            (payer, merchant, amount, anchor),
        );
        Ok(id)
    }

    /// Collects the next due cycle. Callable by anyone once the cycle (or the
    /// retry after a failed attempt) is due.
    ///
    /// Insufficient balance or allowance is reported as
    /// [`ChargeOutcome::Failed`] / [`ChargeOutcome::Lapsed`] rather than an
    /// error, so the failed attempt is persisted.
    pub fn charge(env: Env, id: u64) -> Result<ChargeOutcome, RecurringError> {
        let mut s = load(&env, id)?;
        if s.status != ScheduleStatus::Active {
            return Err(RecurringError::InvalidState);
        }
        let now = env.ledger().timestamp();
        if now < s.next_attempt_at {
            return Err(RecurringError::NotDue);
        }

        let contract = env.current_contract_address();
        let token = token::Client::new(&env, &s.token);
        let funded = token.balance(&s.payer) >= s.amount
            && token.allowance(&s.payer, &contract) >= s.amount;

        if !funded {
            s.failed_attempts += 1;
            let outcome = if s.failed_attempts >= MAX_FAILED_ATTEMPTS {
                s.status = ScheduleStatus::Lapsed;
                ChargeOutcome::Lapsed
            } else {
                s.next_attempt_at = now.saturating_add(RETRY_DELAY_SECS);
                ChargeOutcome::Failed(s.failed_attempts)
            };
            save(&env, &s);
            env.events().publish(
                (TOPIC, symbol_short!("failed"), id),
                (s.next_cycle, s.failed_attempts),
            );
            if outcome == ChargeOutcome::Lapsed {
                env.events()
                    .publish((TOPIC, symbol_short!("lapsed"), id), s.next_cycle);
            }
            return Ok(outcome);
        }

        let charged_cycle = s.next_cycle;
        let next_cycle = charged_cycle
            .checked_add(1)
            .ok_or(RecurringError::Overflow)?;
        let next_due = due_at(s.anchor, &s.cycle, next_cycle).ok_or(RecurringError::Overflow)?;

        token.transfer_from(&contract, &s.payer, &s.merchant, &s.amount);

        s.charges += 1;
        s.next_cycle = next_cycle;
        s.next_due = next_due;
        s.next_attempt_at = next_due;
        s.failed_attempts = 0;
        s.last_charged_at = now;
        let completed = s.max_cycles != 0 && s.charges >= s.max_cycles;
        if completed {
            s.status = ScheduleStatus::Completed;
        }
        save(&env, &s);

        env.events().publish(
            (TOPIC, symbol_short!("charged"), id),
            (charged_cycle, s.amount, next_due),
        );
        if completed {
            env.events()
                .publish((TOPIC, symbol_short!("completed"), id), s.charges);
        }
        Ok(ChargeOutcome::Charged(charged_cycle))
    }

    /// Pauses an active schedule. Requires the payer's auth.
    pub fn pause(env: Env, id: u64) -> Result<(), RecurringError> {
        let mut s = load(&env, id)?;
        s.payer.require_auth();
        if s.status != ScheduleStatus::Active {
            return Err(RecurringError::InvalidState);
        }
        s.status = ScheduleStatus::Paused;
        save(&env, &s);
        env.events()
            .publish((TOPIC, symbol_short!("paused"), id), s.next_due);
        Ok(())
    }

    /// Resumes a paused or lapsed schedule. Requires the payer's auth.
    ///
    /// Cycles that came due while inactive are skipped; the schedule resumes
    /// at the first due date at or after now, on the original anchor.
    pub fn resume(env: Env, id: u64) -> Result<u64, RecurringError> {
        let mut s = load(&env, id)?;
        s.payer.require_auth();
        if s.status != ScheduleStatus::Paused && s.status != ScheduleStatus::Lapsed {
            return Err(RecurringError::InvalidState);
        }
        let now = env.ledger().timestamp();
        let k = first_cycle_at_or_after(s.anchor, &s.cycle, now, s.next_cycle)
            .ok_or(RecurringError::Overflow)?;
        let due = due_at(s.anchor, &s.cycle, k).ok_or(RecurringError::Overflow)?;
        s.next_cycle = k;
        s.next_due = due;
        s.next_attempt_at = due;
        s.failed_attempts = 0;
        s.status = ScheduleStatus::Active;
        save(&env, &s);
        env.events()
            .publish((TOPIC, symbol_short!("resumed"), id), due);
        Ok(due)
    }

    /// Cancels a schedule permanently. `caller` must be the payer or the
    /// merchant and must authorise the call.
    pub fn cancel(env: Env, caller: Address, id: u64) -> Result<(), RecurringError> {
        caller.require_auth();
        let mut s = load(&env, id)?;
        if caller != s.payer && caller != s.merchant {
            return Err(RecurringError::Unauthorized);
        }
        if matches!(
            s.status,
            ScheduleStatus::Cancelled | ScheduleStatus::Completed
        ) {
            return Err(RecurringError::InvalidState);
        }
        s.status = ScheduleStatus::Cancelled;
        save(&env, &s);
        env.events()
            .publish((TOPIC, symbol_short!("cancelled"), id), caller);
        Ok(())
    }

    /// Returns a schedule.
    pub fn get_schedule(env: Env, id: u64) -> Result<Schedule, RecurringError> {
        load(&env, id)
    }

    /// Returns the next `limit` due dates of an active or paused schedule,
    /// starting with the next uncharged cycle and stopping early at
    /// `max_cycles`. Final (cancelled or completed) schedules return none.
    pub fn preview_due_dates(env: Env, id: u64, limit: u32) -> Result<Vec<u64>, RecurringError> {
        if limit == 0 || limit > MAX_PREVIEW {
            return Err(RecurringError::InvalidLimit);
        }
        let s = load(&env, id)?;
        let mut dates = Vec::new(&env);
        if matches!(
            s.status,
            ScheduleStatus::Cancelled | ScheduleStatus::Completed
        ) {
            return Ok(dates);
        }
        let remaining = if s.max_cycles == 0 {
            limit
        } else {
            limit.min(s.max_cycles - s.charges)
        };
        for i in 0..remaining {
            let k = s.next_cycle.checked_add(i).ok_or(RecurringError::Overflow)?;
            match due_at(s.anchor, &s.cycle, k) {
                Some(ts) => dates.push_back(ts),
                None => break,
            }
        }
        Ok(dates)
    }
}

fn load(env: &Env, id: u64) -> Result<Schedule, RecurringError> {
    env.storage()
        .persistent()
        .get(&DataKey::Schedule(id))
        .ok_or(RecurringError::NotFound)
}

fn save(env: &Env, schedule: &Schedule) {
    let key = DataKey::Schedule(schedule.id);
    env.storage().persistent().set(&key, schedule);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

// ════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger as _},
        token::{StellarAssetClient, TokenClient},
        Address, Env,
    };

    const HOUR: u64 = 3_600;

    /// UTC timestamp for a civil date-time.
    fn ts(year: i64, month: u32, day: u32, secs_of_day: u64) -> u64 {
        days_from_civil(year, month, day) as u64 * SECS_PER_DAY + secs_of_day
    }

    fn date(t: u64) -> (i64, u32, u32) {
        civil_from_days((t / SECS_PER_DAY) as i64)
    }

    fn monthly(count: u32) -> Cycle {
        Cycle {
            unit: CycleUnit::Month,
            count,
        }
    }

    struct Setup {
        env: Env,
        client: RecurringChargesClient<'static>,
        token: TokenClient<'static>,
        payer: Address,
        merchant: Address,
    }

    impl Setup {
        fn new(now: u64) -> Self {
            let env = Env::default();
            env.mock_all_auths();
            set_time(&env, now);
            let contract_id = env.register_contract(None, RecurringCharges);
            let client = RecurringChargesClient::new(&env, &contract_id);
            let issuer = Address::generate(&env);
            let token_id = env.register_stellar_asset_contract_v2(issuer).address();
            let token = TokenClient::new(&env, &token_id);
            let payer = Address::generate(&env);
            let merchant = Address::generate(&env);
            StellarAssetClient::new(&env, &token_id).mint(&payer, &10_000);
            Setup {
                env,
                client,
                token,
                payer,
                merchant,
            }
        }

        fn approve(&self, amount: i128) {
            self.token
                .approve(&self.payer, &self.client.address, &amount, &100_000);
        }

        fn create(&self, amount: i128, cycle: Cycle, start: Option<u64>, max: u32) -> u64 {
            self.client.create_schedule(
                &self.payer,
                &self.merchant,
                &self.token.address,
                &amount,
                &cycle,
                &start,
                &max,
            )
        }
    }

    fn set_time(env: &Env, t: u64) {
        env.ledger().with_mut(|l| l.timestamp = t);
    }

    // ── Calendar math ────────────────────────────────────────────

    #[test]
    fn civil_conversion_round_trips() {
        for days in (0..200_000i64).step_by(7) {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(days_from_civil(y, m, d), days);
        }
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(date(ts(2000, 2, 29, 0)), (2000, 2, 29));
    }

    #[test]
    fn month_end_anchor_clamps_and_recovers() {
        let anchor = ts(2028, 1, 31, 9 * HOUR);
        let c = monthly(1);
        assert_eq!(due_at(anchor, &c, 1), Some(ts(2028, 2, 29, 9 * HOUR))); // leap year
        assert_eq!(due_at(anchor, &c, 2), Some(ts(2028, 3, 31, 9 * HOUR))); // no drift
        assert_eq!(due_at(anchor, &c, 3), Some(ts(2028, 4, 30, 9 * HOUR)));
        assert_eq!(due_at(anchor, &c, 13), Some(ts(2029, 2, 28, 9 * HOUR))); // non-leap
    }

    #[test]
    fn leap_day_yearly_anchor() {
        let anchor = ts(2028, 2, 29, 0);
        let c = Cycle {
            unit: CycleUnit::Year,
            count: 1,
        };
        assert_eq!(due_at(anchor, &c, 1), Some(ts(2029, 2, 28, 0)));
        assert_eq!(due_at(anchor, &c, 4), Some(ts(2032, 2, 29, 0)));
        // 2100 is not a leap year (divisible by 100, not 400).
        assert_eq!(due_at(anchor, &c, 72), Some(ts(2100, 2, 28, 0)));
    }

    #[test]
    fn multi_month_cycles_cross_year_boundary() {
        let anchor = ts(2026, 11, 30, 0);
        let c = monthly(3);
        assert_eq!(due_at(anchor, &c, 1), Some(ts(2027, 2, 28, 0)));
        assert_eq!(due_at(anchor, &c, 2), Some(ts(2027, 5, 30, 0)));
        assert_eq!(due_at(anchor, &c, 4), Some(ts(2027, 11, 30, 0)));
    }

    #[test]
    fn day_and_week_cycles_are_fixed_length() {
        let anchor = ts(2026, 3, 1, 12 * HOUR);
        let weekly = Cycle {
            unit: CycleUnit::Week,
            count: 2,
        };
        let daily = Cycle {
            unit: CycleUnit::Day,
            count: 1,
        };
        assert_eq!(due_at(anchor, &weekly, 3), Some(anchor + 6 * SECS_PER_WEEK));
        assert_eq!(due_at(anchor, &daily, 31), Some(ts(2026, 4, 1, 12 * HOUR)));
    }

    #[test]
    fn first_cycle_at_or_after_finds_next_due() {
        let anchor = ts(2026, 1, 31, 0);
        let c = monthly(1);
        // Exactly on a due date counts as due.
        assert_eq!(first_cycle_at_or_after(anchor, &c, ts(2026, 4, 30, 0), 0), Some(3));
        assert_eq!(first_cycle_at_or_after(anchor, &c, ts(2026, 4, 30, 1), 0), Some(4));
        // Never goes below the minimum index.
        assert_eq!(first_cycle_at_or_after(anchor, &c, anchor, 5), Some(5));
        // Long gaps resolve without iterating every cycle.
        assert_eq!(first_cycle_at_or_after(anchor, &c, ts(2126, 1, 1, 0), 0), Some(1200));
    }

    #[test]
    fn overflowing_due_dates_return_none() {
        let c = Cycle {
            unit: CycleUnit::Year,
            count: MAX_CYCLE_COUNT,
        };
        assert_eq!(due_at(0, &c, u32::MAX), None);
        assert_eq!(due_at(u64::MAX - 10, &monthly(1), 1), None);
    }

    // ── Creation ─────────────────────────────────────────────────

    #[test]
    fn create_schedule_validates_input() {
        let now = ts(2026, 1, 1, 0);
        let s = Setup::new(now);
        let tok = &s.token.address;
        let cases = [
            (s.payer.clone(), 0, monthly(1), None, RecurringError::InvalidAmount),
            (s.payer.clone(), 10, monthly(0), None, RecurringError::InvalidCycle),
            (s.payer.clone(), 10, monthly(MAX_CYCLE_COUNT + 1), None, RecurringError::InvalidCycle),
            (s.payer.clone(), 10, monthly(1), Some(now - 1), RecurringError::InvalidStart),
            (s.merchant.clone(), 10, monthly(1), None, RecurringError::InvalidParties),
        ];
        for (payer, amount, cycle, start, err) in cases {
            let res = s
                .client
                .try_create_schedule(&payer, &s.merchant, tok, &amount, &cycle, &start, &0);
            assert_eq!(res, Err(Ok(err)));
        }
    }

    #[test]
    fn create_schedule_stores_state_and_emits_event() {
        let start = ts(2026, 1, 31, 9 * HOUR);
        let s = Setup::new(start - HOUR);
        let id = s.create(100, monthly(1), Some(start), 0);
        assert_eq!(id, 1);
        assert_eq!(s.create(100, monthly(1), None, 0), 2);

        let sched = s.client.get_schedule(&id);
        assert_eq!(sched.status, ScheduleStatus::Active);
        assert_eq!(sched.next_due, start);
        assert_eq!(sched.charges, 0);
        assert!(!s.env.events().all().is_empty());
        assert_eq!(s.client.try_get_schedule(&99), Err(Ok(RecurringError::NotFound)));
    }

    // ── Charging ─────────────────────────────────────────────────

    #[test]
    fn charges_on_calendar_due_dates() {
        let start = ts(2028, 1, 31, 9 * HOUR);
        let s = Setup::new(start);
        s.approve(1_000);
        let id = s.create(100, monthly(1), None, 0);

        assert_eq!(s.client.charge(&id), ChargeOutcome::Charged(0));
        assert_eq!(s.token.balance(&s.payer), 9_900);
        assert_eq!(s.token.balance(&s.merchant), 100);

        let sched = s.client.get_schedule(&id);
        assert_eq!(sched.next_due, ts(2028, 2, 29, 9 * HOUR));
        assert_eq!(sched.last_charged_at, start);

        // Not due one second early; due exactly on time.
        set_time(&s.env, sched.next_due - 1);
        assert_eq!(s.client.try_charge(&id), Err(Ok(RecurringError::NotDue)));
        set_time(&s.env, sched.next_due);
        assert_eq!(s.client.charge(&id), ChargeOutcome::Charged(1));
        assert_eq!(s.client.get_schedule(&id).next_due, ts(2028, 3, 31, 9 * HOUR));
    }

    #[test]
    fn each_cycle_is_charged_once_and_overdue_cycles_catch_up() {
        let start = ts(2026, 1, 1, 0);
        let s = Setup::new(start);
        s.approve(1_000);
        let id = s.create(100, monthly(1), None, 0);
        s.client.charge(&id);
        assert_eq!(s.client.try_charge(&id), Err(Ok(RecurringError::NotDue)));

        // Keeper was offline for Feb and Mar; both are collectable, Apr is not.
        set_time(&s.env, ts(2026, 3, 15, 0));
        assert_eq!(s.client.charge(&id), ChargeOutcome::Charged(1));
        assert_eq!(s.client.charge(&id), ChargeOutcome::Charged(2));
        assert_eq!(s.client.try_charge(&id), Err(Ok(RecurringError::NotDue)));
        assert_eq!(s.token.balance(&s.merchant), 300);
    }

    #[test]
    fn insufficient_allowance_retries_then_lapses() {
        let start = ts(2026, 1, 1, 0);
        let s = Setup::new(start);
        let id = s.create(100, monthly(1), None, 0); // no approval yet

        assert_eq!(s.client.charge(&id), ChargeOutcome::Failed(1));
        assert_eq!(s.token.balance(&s.merchant), 0);
        // Retry is throttled.
        assert_eq!(s.client.try_charge(&id), Err(Ok(RecurringError::NotDue)));

        set_time(&s.env, start + RETRY_DELAY_SECS);
        assert_eq!(s.client.charge(&id), ChargeOutcome::Failed(2));
        set_time(&s.env, start + 2 * RETRY_DELAY_SECS);
        assert_eq!(s.client.charge(&id), ChargeOutcome::Lapsed);

        let sched = s.client.get_schedule(&id);
        assert_eq!(sched.status, ScheduleStatus::Lapsed);
        assert_eq!(sched.charges, 0);
        assert_eq!(s.client.try_charge(&id), Err(Ok(RecurringError::InvalidState)));
    }

    #[test]
    fn insufficient_balance_fails_and_success_resets_counter() {
        let start = ts(2026, 1, 1, 0);
        let s = Setup::new(start);
        s.approve(1_000_000);
        let id = s.create(20_000, monthly(1), None, 0); // balance is 10 000

        assert_eq!(s.client.charge(&id), ChargeOutcome::Failed(1));
        StellarAssetClient::new(&s.env, &s.token.address).mint(&s.payer, &20_000);
        set_time(&s.env, start + RETRY_DELAY_SECS);
        assert_eq!(s.client.charge(&id), ChargeOutcome::Charged(0));

        let sched = s.client.get_schedule(&id);
        assert_eq!(sched.failed_attempts, 0);
        // A late successful retry keeps the next due date on the anchor.
        assert_eq!(sched.next_due, ts(2026, 2, 1, 0));
    }

    #[test]
    fn completes_after_max_cycles() {
        let start = ts(2026, 1, 1, 0);
        let s = Setup::new(start);
        s.approve(1_000);
        let id = s.create(100, monthly(1), None, 2);
        assert_eq!(s.client.preview_due_dates(&id, &10).len(), 2);

        s.client.charge(&id);
        set_time(&s.env, ts(2026, 2, 1, 0));
        s.client.charge(&id);

        assert_eq!(s.client.get_schedule(&id).status, ScheduleStatus::Completed);
        set_time(&s.env, ts(2026, 3, 1, 0));
        assert_eq!(s.client.try_charge(&id), Err(Ok(RecurringError::InvalidState)));
        assert_eq!(s.client.preview_due_dates(&id, &10).len(), 0);
        assert_eq!(s.token.balance(&s.merchant), 200);
    }

    // ── Lifecycle ────────────────────────────────────────────────

    #[test]
    fn pause_skips_cycles_and_resume_stays_on_anchor() {
        let start = ts(2026, 1, 31, 0);
        let s = Setup::new(start);
        s.approve(1_000);
        let id = s.create(100, monthly(1), None, 0);
        s.client.charge(&id);
        s.client.pause(&id);

        set_time(&s.env, ts(2026, 3, 10, 0));
        assert_eq!(s.client.try_charge(&id), Err(Ok(RecurringError::InvalidState)));
        assert_eq!(s.client.try_pause(&id), Err(Ok(RecurringError::InvalidState)));

        // Feb 28 was skipped; next due is Mar 31, still on the 31st anchor.
        assert_eq!(s.client.resume(&id), ts(2026, 3, 31, 0));
        assert_eq!(s.client.try_charge(&id), Err(Ok(RecurringError::NotDue)));
        set_time(&s.env, ts(2026, 3, 31, 0));
        assert_eq!(s.client.charge(&id), ChargeOutcome::Charged(2));
        assert_eq!(s.token.balance(&s.merchant), 200);
    }

    #[test]
    fn lapsed_schedule_can_resume() {
        let start = ts(2026, 1, 1, 0);
        let s = Setup::new(start);
        let id = s.create(100, monthly(1), None, 0);
        for i in 0..MAX_FAILED_ATTEMPTS as u64 {
            set_time(&s.env, start + i * RETRY_DELAY_SECS);
            s.client.charge(&id);
        }
        assert_eq!(s.client.get_schedule(&id).status, ScheduleStatus::Lapsed);

        s.approve(1_000);
        assert_eq!(s.client.resume(&id), ts(2026, 2, 1, 0));
        let sched = s.client.get_schedule(&id);
        assert_eq!(sched.status, ScheduleStatus::Active);
        assert_eq!(sched.failed_attempts, 0);
    }

    #[test]
    fn resume_requires_paused_or_lapsed() {
        let s = Setup::new(ts(2026, 1, 1, 0));
        let id = s.create(100, monthly(1), None, 0);
        assert_eq!(s.client.try_resume(&id), Err(Ok(RecurringError::InvalidState)));
    }

    #[test]
    fn cancel_by_payer_or_merchant_only() {
        let s = Setup::new(ts(2026, 1, 1, 0));
        s.approve(1_000);
        let a = s.create(100, monthly(1), None, 0);
        let b = s.create(100, monthly(1), None, 0);

        let stranger = Address::generate(&s.env);
        assert_eq!(
            s.client.try_cancel(&stranger, &a),
            Err(Ok(RecurringError::Unauthorized))
        );
        s.client.cancel(&s.merchant, &a);
        s.client.cancel(&s.payer, &b);
        assert_eq!(s.client.get_schedule(&a).status, ScheduleStatus::Cancelled);
        assert_eq!(s.client.try_charge(&a), Err(Ok(RecurringError::InvalidState)));
        assert_eq!(
            s.client.try_cancel(&s.payer, &a),
            Err(Ok(RecurringError::InvalidState))
        );
        assert_eq!(s.client.try_resume(&b), Err(Ok(RecurringError::InvalidState)));
    }

    #[test]
    fn preview_lists_upcoming_calendar_dates() {
        let start = ts(2027, 10, 31, 0);
        let s = Setup::new(start);
        let id = s.create(100, monthly(1), None, 0);
        let dates = s.client.preview_due_dates(&id, &5);
        let expected = [
            ts(2027, 10, 31, 0),
            ts(2027, 11, 30, 0),
            ts(2027, 12, 31, 0),
            ts(2028, 1, 31, 0),
            ts(2028, 2, 29, 0),
        ];
        assert_eq!(dates.len(), 5);
        for (i, want) in expected.iter().enumerate() {
            assert_eq!(dates.get(i as u32), Some(*want));
        }
        assert_eq!(
            s.client.try_preview_due_dates(&id, &0),
            Err(Ok(RecurringError::InvalidLimit))
        );
        assert_eq!(
            s.client.try_preview_due_dates(&id, &(MAX_PREVIEW + 1)),
            Err(Ok(RecurringError::InvalidLimit))
        );
    }

    #[test]
    fn auth_is_required_from_the_right_party() {
        let s = Setup::new(ts(2026, 1, 1, 0));
        let id = s.create(100, monthly(1), None, 0);
        s.client.pause(&id);
        let auths = s.env.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, s.payer);
    }
}
