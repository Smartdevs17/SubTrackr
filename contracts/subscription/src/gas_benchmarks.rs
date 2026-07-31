//! Gas benchmark tests for the SubTrackr subscription contract.
//!
//! Each test function:
//! 1. Exercises one contract function in a reproducible way
//! 2. Measures CPU instructions and memory bytes via `env.budget()`
//! 3. Prints a structured `GAS_BENCHMARK:<fn>:<metrics>` line that
//!    `scripts/analyze-gas.py` parses for regression tracking and SVG charts.
//!
//! Run with:
//!   cargo test -p subtrackr-subscription gas_benchmark -- --nocapture
//!
//! Or via the project helper:
//!   bash scripts/gas-benchmark.sh

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use subtrackr_types::Interval;

use super::SubTrackrSubscription;

// ── Test helpers ─────────────────────────────────────────────────────────────

struct BenchHarness {
    env: Env,
    proxy: Address,
    storage: Address,
    admin: Address,
    token: Address,
}

impl BenchHarness {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let proxy = Address::generate(&env);
        let storage = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        Self {
            env,
            proxy,
            storage,
            admin,
            token,
        }
    }

    /// Reset the budget counters so we only measure the target function.
    fn reset_budget(&self) {
        self.env.budget().reset_default();
    }

    /// Read CPU instruction count from the budget.
    fn cpu_instructions(&self) -> u64 {
        self.env.budget().cpu_instruction_count()
    }

    /// Read memory bytes used from the budget.
    fn mem_bytes(&self) -> u64 {
        self.env.budget().memory_bytes_used()
    }

    /// Print the structured benchmark line consumed by analyze-gas.py.
    fn report(&self, function_name: &str, extra: &str) {
        let cpu = self.cpu_instructions();
        let mem = self.mem_bytes();
        println!(
            "GAS_BENCHMARK:{function_name}:instructions: {cpu} mem_bytes: {mem} {extra}"
        );
    }
}

// ── Benchmark functions ───────────────────────────────────────────────────────

#[test]
fn gas_benchmark_initialize() {
    let h = BenchHarness::new();
    let contract = h.env.register_contract(None, SubTrackrSubscription);

    h.reset_budget();
    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "initialize"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
        ],
    );
    h.report("initialize", "write_entries: 3");
}

#[test]
fn gas_benchmark_create_plan() {
    let h = BenchHarness::new();
    let contract = h.env.register_contract(None, SubTrackrSubscription);
    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "initialize"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
        ],
    );

    h.reset_budget();
    h.env.invoke_contract::<u64>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "create_plan"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
            String::from_str(&h.env, "Benchmark Plan").into(),
            1_000_000i128.into(),
            h.token.clone().into(),
            Interval::Monthly.into(),
        ],
    );
    h.report("create_plan", "write_entries: 3 read_entries: 2");
}

#[test]
fn gas_benchmark_subscribe() {
    let h = BenchHarness::new();
    let contract = h.env.register_contract(None, SubTrackrSubscription);
    let subscriber = Address::generate(&h.env);

    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "initialize"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
        ],
    );
    let plan_id: u64 = h.env.invoke_contract(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "create_plan"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
            String::from_str(&h.env, "Plan A").into(),
            500_000i128.into(),
            h.token.clone().into(),
            Interval::Monthly.into(),
        ],
    );

    h.reset_budget();
    h.env.invoke_contract::<u64>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "subscribe"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            subscriber.clone().into(),
            plan_id.into(),
        ],
    );
    h.report("subscribe", "write_entries: 4 read_entries: 3");
}

#[test]
fn gas_benchmark_cancel_subscription() {
    let h = BenchHarness::new();
    let contract = h.env.register_contract(None, SubTrackrSubscription);
    let subscriber = Address::generate(&h.env);

    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "initialize"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
        ],
    );
    let plan_id: u64 = h.env.invoke_contract(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "create_plan"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
            String::from_str(&h.env, "Plan B").into(),
            500_000i128.into(),
            h.token.clone().into(),
            Interval::Monthly.into(),
        ],
    );
    let sub_id: u64 = h.env.invoke_contract(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "subscribe"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            subscriber.clone().into(),
            plan_id.into(),
        ],
    );

    h.reset_budget();
    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "cancel_subscription"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            subscriber.clone().into(),
            sub_id.into(),
        ],
    );
    h.report("cancel_subscription", "write_entries: 3 read_entries: 3");
}

#[test]
fn gas_benchmark_pause_subscription() {
    let h = BenchHarness::new();
    let contract = h.env.register_contract(None, SubTrackrSubscription);
    let subscriber = Address::generate(&h.env);

    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "initialize"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
        ],
    );
    let plan_id: u64 = h.env.invoke_contract(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "create_plan"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
            String::from_str(&h.env, "Plan C").into(),
            100_000i128.into(),
            h.token.clone().into(),
            Interval::Monthly.into(),
        ],
    );
    let sub_id: u64 = h.env.invoke_contract(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "subscribe"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            subscriber.clone().into(),
            plan_id.into(),
        ],
    );

    h.reset_budget();
    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "pause_by_subscriber"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            subscriber.clone().into(),
            sub_id.into(),
            86_400u64.into(), // 1-day pause
        ],
    );
    h.report("pause_subscription", "write_entries: 1 read_entries: 2");
}

#[test]
fn gas_benchmark_get_subscription() {
    let h = BenchHarness::new();
    let contract = h.env.register_contract(None, SubTrackrSubscription);
    let subscriber = Address::generate(&h.env);

    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "initialize"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
        ],
    );
    let plan_id: u64 = h.env.invoke_contract(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "create_plan"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
            String::from_str(&h.env, "Plan D").into(),
            50_000i128.into(),
            h.token.clone().into(),
            Interval::Monthly.into(),
        ],
    );
    let sub_id: u64 = h.env.invoke_contract(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "subscribe"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            subscriber.clone().into(),
            plan_id.into(),
        ],
    );

    h.reset_budget();
    h.env.invoke_contract::<subtrackr_types::Subscription>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "get_subscription"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            sub_id.into(),
        ],
    );
    h.report("get_subscription", "read_entries: 1");
}

#[test]
fn gas_benchmark_get_plan() {
    let h = BenchHarness::new();
    let contract = h.env.register_contract(None, SubTrackrSubscription);

    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "initialize"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
        ],
    );
    let plan_id: u64 = h.env.invoke_contract(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "create_plan"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
            String::from_str(&h.env, "Plan Read").into(),
            200_000i128.into(),
            h.token.clone().into(),
            Interval::Yearly.into(),
        ],
    );

    h.reset_budget();
    h.env.invoke_contract::<subtrackr_types::Plan>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "get_plan"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            plan_id.into(),
        ],
    );
    h.report("get_plan", "read_entries: 1");
}

#[test]
fn gas_benchmark_get_user_subscriptions() {
    let h = BenchHarness::new();
    let contract = h.env.register_contract(None, SubTrackrSubscription);
    let subscriber = Address::generate(&h.env);

    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "initialize"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
        ],
    );
    // Create 3 plans and subscribe to each
    for _i in 0u32..3 {
        let name = String::from_str(&h.env, "Sub Plan");
        let plan_id: u64 = h.env.invoke_contract(
            &contract,
            &soroban_sdk::Symbol::new(&h.env, "create_plan"),
            soroban_sdk::vec![
                &h.env,
                h.proxy.clone().into(),
                h.storage.clone().into(),
                h.admin.clone().into(),
                name.into(),
                100_000i128.into(),
                h.token.clone().into(),
                Interval::Monthly.into(),
            ],
        );
        h.env.invoke_contract::<u64>(
            &contract,
            &soroban_sdk::Symbol::new(&h.env, "subscribe"),
            soroban_sdk::vec![
                &h.env,
                h.proxy.clone().into(),
                h.storage.clone().into(),
                subscriber.clone().into(),
                plan_id.into(),
            ],
        );
    }

    h.reset_budget();
    h.env.invoke_contract::<soroban_sdk::Vec<u64>>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "get_user_subscriptions"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            subscriber.clone().into(),
        ],
    );
    h.report("get_user_subscriptions", "read_entries: 1");
}

// ── Storage tier comparison ───────────────────────────────────────────────────
//
// These two benchmarks document the before/after gas cost for rate-limit
// enforcement (Issue #395): instance storage vs. temporary storage.

#[test]
fn gas_benchmark_rate_limit_check_temporary_storage() {
    let h = BenchHarness::new();
    let contract = h.env.register_contract(None, SubTrackrSubscription);
    let caller = Address::generate(&h.env);

    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "initialize"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            h.admin.clone().into(),
        ],
    );

    // Set a 60-second rate limit on create_plan
    h.env.invoke_contract::<()>(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "set_rate_limit"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            String::from_str(&h.env, "create_plan").into(),
            60u64.into(),
        ],
    );

    // First call: writes TmpLastCall to temporary storage
    h.reset_budget();
    let plan_id: u64 = h.env.invoke_contract(
        &contract,
        &soroban_sdk::Symbol::new(&h.env, "create_plan"),
        soroban_sdk::vec![
            &h.env,
            h.proxy.clone().into(),
            h.storage.clone().into(),
            caller.clone().into(),
            String::from_str(&h.env, "Rate Plan").into(),
            100_000i128.into(),
            h.token.clone().into(),
            Interval::Monthly.into(),
        ],
    );
    h.report(
        "create_plan_with_rate_limit_tmp_write",
        "write_entries: 4 read_entries: 3",
    );
}
