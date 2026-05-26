#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env, Symbol};

fn setup() -> (Env, SubTrackrOracleClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SubTrackrOracle);
    let client = SubTrackrOracleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

fn set_time(env: &Env, t: u64) {
    env.ledger().with_mut(|l| l.timestamp = t);
}

#[test]
fn registers_and_reads_price() {
    let (env, client, _admin) = setup();
    let token = Symbol::new(&env, "XLM");
    let usd = Symbol::new(&env, "USD");
    let primary = Address::generate(&env);
    set_time(&env, 1_000);
    client.register_feed(&token, &usd, &primary, &None, &300, &500, &7);
    client.submit_price(&primary, &token, &usd, &1_234_000, &1_000);

    let price = client.get_price(&token, &usd);
    assert_eq!(price.value, 1_234_000);
    assert_eq!(price.decimals, 7);
    assert_eq!(price.source, PriceSource::Primary);
}

#[test]
fn supports_multiple_quote_currencies() {
    let (env, client, _admin) = setup();
    let token = Symbol::new(&env, "XLM");
    let usd = Symbol::new(&env, "USD");
    let eur = Symbol::new(&env, "EUR");
    let primary = Address::generate(&env);
    set_time(&env, 1_000);
    client.register_feed(&token, &usd, &primary, &None, &300, &10_000, &7);
    client.register_feed(&token, &eur, &primary, &None, &300, &10_000, &7);
    client.submit_price(&primary, &token, &usd, &1_200_000, &1_000);
    client.submit_price(&primary, &token, &eur, &1_100_000, &1_000);

    assert_eq!(client.get_price(&token, &usd).value, 1_200_000);
    assert_eq!(client.get_price(&token, &eur).value, 1_100_000);
}

#[test]
fn rejects_unauthorized_source() {
    let (env, client, _admin) = setup();
    let token = Symbol::new(&env, "XLM");
    let usd = Symbol::new(&env, "USD");
    let primary = Address::generate(&env);
    let stranger = Address::generate(&env);
    set_time(&env, 1_000);
    client.register_feed(&token, &usd, &primary, &None, &300, &10_000, &7);
    let res = client.try_submit_price(&stranger, &token, &usd, &1_000, &1_000);
    assert_eq!(res, Err(Ok(OracleError::Unauthorized)));
}

#[test]
fn detects_stale_price() {
    let (env, client, _admin) = setup();
    let token = Symbol::new(&env, "XLM");
    let usd = Symbol::new(&env, "USD");
    let primary = Address::generate(&env);
    set_time(&env, 1_000);
    client.register_feed(&token, &usd, &primary, &None, &300, &10_000, &7);
    client.submit_price(&primary, &token, &usd, &1_000_000, &1_000);

    // Advance well past the staleness window.
    set_time(&env, 2_000);
    let res = client.try_get_price(&token, &usd);
    assert_eq!(res, Err(Ok(OracleError::StalePrice)));
}

#[test]
fn falls_back_when_primary_is_stale() {
    let (env, client, _admin) = setup();
    let token = Symbol::new(&env, "XLM");
    let usd = Symbol::new(&env, "USD");
    let primary = Address::generate(&env);
    let fallback = Address::generate(&env);
    set_time(&env, 1_000);
    client.register_feed(&token, &usd, &primary, &Some(fallback.clone()), &300, &10_000, &7);
    client.submit_price(&primary, &token, &usd, &1_000_000, &1_000);

    // Fresh fallback observation while the primary ages out.
    set_time(&env, 1_250);
    client.submit_price(&fallback, &token, &usd, &1_010_000, &1_250);
    set_time(&env, 1_400); // primary now stale (>300s), fallback still fresh

    let price = client.get_price(&token, &usd);
    assert_eq!(price.source, PriceSource::Fallback);
    assert_eq!(price.value, 1_010_000);
}

#[test]
fn deviation_trips_circuit_breaker() {
    let (env, client, _admin) = setup();
    let token = Symbol::new(&env, "XLM");
    let usd = Symbol::new(&env, "USD");
    let primary = Address::generate(&env);
    set_time(&env, 1_000);
    // 1% deviation tolerance.
    client.register_feed(&token, &usd, &primary, &None, &10_000, &100, &7);

    client.submit_price(&primary, &token, &usd, &1_000_000, &1_000);
    // Three consecutive doublings each exceed 1%, tripping after the limit.
    client.submit_price(&primary, &token, &usd, &2_000_000, &1_000);
    client.submit_price(&primary, &token, &usd, &4_000_000, &1_000);
    client.submit_price(&primary, &token, &usd, &8_000_000, &1_000);

    let state = client.get_circuit_state(&token, &usd);
    assert!(state.tripped);

    let res = client.try_get_price(&token, &usd);
    assert_eq!(res, Err(Ok(OracleError::CircuitOpen)));

    // Admin reset restores reads.
    client.reset_circuit(&token, &usd);
    let price = client.get_price(&token, &usd);
    assert_eq!(price.value, 8_000_000);
}

#[test]
fn cache_serves_value_within_ttl() {
    let (env, client, _admin) = setup();
    let token = Symbol::new(&env, "XLM");
    let usd = Symbol::new(&env, "USD");
    let primary = Address::generate(&env);
    set_time(&env, 1_000);
    client.register_feed(&token, &usd, &primary, &None, &10_000, &10_000, &7);
    client.submit_price(&primary, &token, &usd, &1_000_000, &1_000);

    // Prime the cache.
    let first = client.get_price_with_cache(&token, &usd, &600);
    assert_eq!(first.value, 1_000_000);

    // A newer submission should be hidden while the cache is warm.
    set_time(&env, 1_300);
    client.submit_price(&primary, &token, &usd, &1_050_000, &1_300);
    let cached = client.get_price_with_cache(&token, &usd, &600);
    assert_eq!(cached.value, 1_000_000);

    // After the TTL elapses the fresh value is returned.
    set_time(&env, 1_700);
    let refreshed = client.get_price_with_cache(&token, &usd, &600);
    assert_eq!(refreshed.value, 1_050_000);
}

#[test]
fn historical_lookup_returns_at_or_before() {
    let (env, client, _admin) = setup();
    let token = Symbol::new(&env, "XLM");
    let usd = Symbol::new(&env, "USD");
    let primary = Address::generate(&env);
    set_time(&env, 5_000);
    client.register_feed(&token, &usd, &primary, &None, &100_000, &10_000, &7);
    client.submit_price(&primary, &token, &usd, &1_000_000, &1_000);
    client.submit_price(&primary, &token, &usd, &1_100_000, &2_000);
    client.submit_price(&primary, &token, &usd, &1_200_000, &3_000);

    assert_eq!(client.get_historical_price(&token, &usd, &2_500).value, 1_100_000);
    assert_eq!(client.get_historical_price(&token, &usd, &3_000).value, 1_200_000);
    let res = client.try_get_historical_price(&token, &usd, &500);
    assert_eq!(res, Err(Ok(OracleError::NoHistory)));
}

#[test]
fn deviation_unit_math() {
    assert_eq!(deviation_bps(1_000_000, 1_010_000), 100); // +1%
    assert_eq!(deviation_bps(1_000_000, 990_000), 100); // -1%
    assert_eq!(deviation_bps(0, 5), 0); // no base
}
