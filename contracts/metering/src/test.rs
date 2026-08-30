use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env, Symbol, Vec};
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

fn tier(up_to_units: u64, unit_price: i128, flat_fee: i128) -> PriceTier {
    PriceTier {
        up_to_units,
        unit_price,
        flat_fee,
    }
}

fn full_period() -> TimeRange {
    TimeRange {
        start: 0,
        end: 1_000_000,
    }
}

#[test]
fn graduated_tiers_price_each_slice_at_its_own_rate() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);

    // 100 units free, then 1_000 overage units @ 3, then everything @ 1.
    let tiers = Vec::from_array(&env, [tier(1_000, 3, 0), tier(0, 1, 0)]);
    client.register_tiered_meter(
        &reporter,
        &1,
        &api,
        &0,
        &100,
        &86_400,
        &0,
        &PricingModel::Graduated,
        &tiers,
    );

    // 1_600 used -> 1_500 billable -> 1_000 @ 3 (3_000) + 500 @ 1 (500).
    client.record_metered_usage(&reporter, &1, &api, &1_600);

    let charge = client.calculate_usage_charge(&1, &full_period());
    assert_eq!(charge.total, 3_500);

    let line = charge.lines.get(0).unwrap();
    assert_eq!(line.units, 1_600);
    assert_eq!(line.billable_units, 1_500);
    assert_eq!(line.tier_lines.len(), 2);
    assert_eq!(line.tier_lines.get(0).unwrap().units, 1_000);
    assert_eq!(line.tier_lines.get(0).unwrap().amount, 3_000);
    assert_eq!(line.tier_lines.get(1).unwrap().units, 500);
    assert_eq!(line.tier_lines.get(1).unwrap().amount, 500);
}

#[test]
fn graduated_charge_is_zero_inside_the_included_allowance() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);

    let tiers = Vec::from_array(&env, [tier(0, 5, 0)]);
    client.register_tiered_meter(
        &reporter,
        &1,
        &api,
        &0,
        &500,
        &86_400,
        &0,
        &PricingModel::Graduated,
        &tiers,
    );
    client.record_metered_usage(&reporter, &1, &api, &499);

    let charge = client.calculate_usage_charge(&1, &full_period());
    assert_eq!(charge.total, 0);
    assert_eq!(charge.lines.get(0).unwrap().billable_units, 0);
    assert_eq!(charge.lines.get(0).unwrap().tier_lines.len(), 0);
}

#[test]
fn volume_pricing_rates_every_unit_at_the_reached_tier() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);

    // <=100 @ 10, <=1_000 @ 6, beyond @ 4.
    let tiers = Vec::from_array(&env, [tier(100, 10, 0), tier(1_000, 6, 0), tier(0, 4, 0)]);
    client.register_tiered_meter(
        &reporter,
        &2,
        &api,
        &0,
        &0,
        &86_400,
        &0,
        &PricingModel::Volume,
        &tiers,
    );

    // 500 units lands in the second band -> all 500 priced at 6.
    client.record_metered_usage(&reporter, &2, &api, &500);
    assert_eq!(
        client.calculate_usage_charge(&2, &full_period()).total,
        3_000
    );
}

#[test]
fn volume_pricing_crossing_a_boundary_lowers_the_whole_bill() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);

    let tiers = Vec::from_array(&env, [tier(100, 10, 0), tier(0, 4, 0)]);
    client.register_tiered_meter(
        &reporter,
        &3,
        &api,
        &0,
        &0,
        &86_400,
        &0,
        &PricingModel::Volume,
        &tiers,
    );

    client.record_metered_usage(&reporter, &3, &api, &100); // 100 * 10
    assert_eq!(
        client.calculate_usage_charge(&3, &full_period()).total,
        1_000
    );

    client.record_metered_usage(&reporter, &3, &api, &1); // 101 units -> 101 * 4
    assert_eq!(client.calculate_usage_charge(&3, &full_period()).total, 404);
}

#[test]
fn package_pricing_charges_whole_blocks() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);

    // Blocks of 1_000 units at a flat 25 per block.
    let tiers = Vec::from_array(&env, [tier(1_000, 0, 25)]);
    client.register_tiered_meter(
        &reporter,
        &4,
        &api,
        &0,
        &0,
        &86_400,
        &0,
        &PricingModel::Package,
        &tiers,
    );

    // 2_001 units -> 3 started blocks -> 75.
    client.record_metered_usage(&reporter, &4, &api, &2_001);
    assert_eq!(client.calculate_usage_charge(&4, &full_period()).total, 75);
}

#[test]
fn tier_flat_fees_are_added_once_per_entered_band() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);

    // Entering the overage band costs a 50 platform fee on top of 2/unit.
    let tiers = Vec::from_array(&env, [tier(0, 2, 50)]);
    client.register_tiered_meter(
        &reporter,
        &5,
        &api,
        &0,
        &10,
        &86_400,
        &0,
        &PricingModel::Graduated,
        &tiers,
    );

    client.record_metered_usage(&reporter, &5, &api, &20); // 10 billable
    assert_eq!(client.calculate_usage_charge(&5, &full_period()).total, 70);
}

#[test]
fn rejects_unordered_or_negative_tiers() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");

    let descending = Vec::from_array(&env, [tier(1_000, 1, 0), tier(100, 2, 0)]);
    assert_eq!(
        client.try_register_tiered_meter(
            &reporter,
            &6,
            &api,
            &0,
            &0,
            &86_400,
            &0,
            &PricingModel::Graduated,
            &descending,
        ),
        Err(Ok(MeteringError::InvalidTiers))
    );

    let negative = Vec::from_array(&env, [tier(0, -1, 0)]);
    assert_eq!(
        client.try_register_tiered_meter(
            &reporter,
            &6,
            &api,
            &0,
            &0,
            &86_400,
            &0,
            &PricingModel::Graduated,
            &negative,
        ),
        Err(Ok(MeteringError::InvalidTiers))
    );
}

#[test]
fn rejects_unbounded_tier_that_is_not_last() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    let tiers = Vec::from_array(&env, [tier(0, 1, 0), tier(100, 2, 0)]);
    assert_eq!(
        client.try_register_tiered_meter(
            &reporter,
            &7,
            &api,
            &0,
            &0,
            &86_400,
            &0,
            &PricingModel::Graduated,
            &tiers,
        ),
        Err(Ok(MeteringError::InvalidTiers))
    );
}

#[test]
fn rejects_tiered_model_without_a_ladder() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    let empty: Vec<PriceTier> = Vec::new(&env);
    assert_eq!(
        client.try_register_tiered_meter(
            &reporter,
            &8,
            &api,
            &1,
            &0,
            &86_400,
            &0,
            &PricingModel::Graduated,
            &empty,
        ),
        Err(Ok(MeteringError::InvalidTiers))
    );
}

#[test]
fn quote_prices_hypothetical_units_without_recording() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);

    let tiers = Vec::from_array(&env, [tier(1_000, 3, 0), tier(0, 1, 0)]);
    client.register_tiered_meter(
        &reporter,
        &9,
        &api,
        &0,
        &100,
        &86_400,
        &0,
        &PricingModel::Graduated,
        &tiers,
    );

    let quote = client.quote_usage(&9, &api, &1_600);
    assert_eq!(quote.amount, 3_500);
    assert_eq!(quote.billable_units, 1_500);
    // Nothing was persisted by quoting.
    assert_eq!(client.get_usage_total(&9, &api), 0);
}

#[test]
fn reconfiguring_the_ladder_rerates_existing_usage() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);

    client.register_meter(&reporter, &10, &api, &10, &0, &86_400, &0);
    client.record_metered_usage(&reporter, &10, &api, &200);
    assert_eq!(
        client.calculate_usage_charge(&10, &full_period()).total,
        2_000
    );

    let tiers = Vec::from_array(&env, [tier(0, 1, 0)]);
    client.register_tiered_meter(
        &reporter,
        &10,
        &api,
        &0,
        &0,
        &86_400,
        &0,
        &PricingModel::Graduated,
        &tiers,
    );

    // Totals survive reconfiguration and are re-rated at the new price.
    assert_eq!(client.get_usage_total(&10, &api), 200);
    assert_eq!(
        client.calculate_usage_charge(&10, &full_period()).total,
        200
    );
}

#[test]
fn flat_meters_keep_a_single_tier_line() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    set_time(&env, 1_000);

    client.register_meter(&reporter, &11, &api, &2, &100, &86_400, &0);
    client.record_metered_usage(&reporter, &11, &api, &150);

    let charge = client.calculate_usage_charge(&11, &full_period());
    let line = charge.lines.get(0).unwrap();
    assert_eq!(line.amount, 100);
    assert_eq!(line.tier_lines.len(), 1);
    assert_eq!(line.tier_lines.get(0).unwrap().units, 50);
}

#[test]
fn rejects_negative_unit_price() {
    let (env, client, reporter) = setup();
    let api = Symbol::new(&env, "api_calls");
    let empty: Vec<PriceTier> = Vec::new(&env);
    assert_eq!(
        client.try_register_tiered_meter(
            &reporter,
            &12,
            &api,
            &-1,
            &0,
            &86_400,
            &0,
            &PricingModel::Flat,
            &empty,
        ),
        Err(Ok(MeteringError::InvalidValue))
    );
}
