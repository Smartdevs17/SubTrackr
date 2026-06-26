#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env, Symbol};
use subtrackr_types::TimeRange;

fn setup() -> (Env, SubTrackrMeteringClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SubTrackrMetering);
    let client = SubTrackrMeteringClient::new(&env, &id);
    let reporter = Address::generate(&env);
    (env, client, reporter)
}

fn set_time(env: &Env, t: u64) {
    env.ledger().with_mut(|l| l.timestamp = t);
}

#[test]
fn ingests_usage_and_tracks_total() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);
    client.register_meter(&reporter, &1, &api, &2, &0, &86_400, &0);
    client.record_metered_usage(&reporter, &1, &api, &10);
    client.record_metered_usage(&reporter, &1, &api, &5);
    assert_eq!(client.get_usage_total(&1, &api), 15);
}

#[test]
fn rejects_zero_value() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    let res = client.try_record_metered_usage(&reporter, &1, &api, &0);
    assert_eq!(res, Err(Ok(MeteringError::InvalidValue)));
}

#[test]
fn aggregates_into_period_buckets() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    // Hourly buckets.
    client.register_meter(&reporter, &1, &api, &1, &0, &3_600, &0);

    set_time(&env, 3_600); // bucket starts at 3_600
    client.record_metered_usage(&reporter, &1, &api, &4);
    client.record_metered_usage(&reporter, &1, &api, &6); // same bucket -> 10
    set_time(&env, 7_300); // next bucket starts at 7_200
    client.record_metered_usage(&reporter, &1, &api, &3);

    let state = client.get_meter(&1, &api);
    assert_eq!(state.buckets.len(), 2);
    assert_eq!(state.buckets.get(0).unwrap().units, 10);
    assert_eq!(state.buckets.get(1).unwrap().units, 3);
}

#[test]
fn supports_multiple_meters_and_charges() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    let egress = Symbol::new(&env, "gb_egress");
    set_time(&env, 1_000);
    // api: 100 free, then 2/unit. egress: 0 free, 5/unit.
    client.register_meter(&reporter, &7, &api, &2, &100, &86_400, &0);
    client.register_meter(&reporter, &7, &egress, &5, &0, &86_400, &0);

    client.record_metered_usage(&reporter, &7, &api, &150); // 50 billable * 2 = 100
    client.record_metered_usage(&reporter, &7, &egress, &4); // 4 * 5 = 20

    let meters = client.get_meters(&7);
    assert_eq!(meters.len(), 2);

    let period = TimeRange {
        start: 0,
        end: 100_000,
    };
    let charge = client.calculate_usage_charge(&7, &period);
    assert_eq!(charge.total, 120);
    assert_eq!(charge.lines.len(), 2);
}

#[test]
fn charge_excludes_usage_outside_period() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    client.register_meter(&reporter, &1, &api, &1, &0, &3_600, &0);

    set_time(&env, 3_600);
    client.record_metered_usage(&reporter, &1, &api, &10); // bucket @3_600
    set_time(&env, 100_000);
    client.record_metered_usage(&reporter, &1, &api, &7); // bucket @97_200

    // Period covering only the first bucket.
    let charge = client.calculate_usage_charge(
        &1,
        &TimeRange {
            start: 0,
            end: 50_000,
        },
    );
    assert_eq!(charge.total, 10);
}

#[test]
fn fires_usage_alert_once_past_threshold() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);
    client.register_meter(&reporter, &1, &api, &1, &0, &86_400, &100); // alert at 100

    client.record_metered_usage(&reporter, &1, &api, &60);
    assert!(!client.get_meter(&1, &api).alert_fired);
    client.record_metered_usage(&reporter, &1, &api, &60); // total 120 -> fires
    assert!(client.get_meter(&1, &api).alert_fired);
}

#[test]
fn rejects_inverted_period() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    client.register_meter(&reporter, &1, &api, &1, &0, &86_400, &0);
    let res = client.try_calculate_usage_charge(
        &1,
        &TimeRange {
            start: 100,
            end: 50,
        },
    );
    assert_eq!(res, Err(Ok(MeteringError::InvalidPeriod)));
}
