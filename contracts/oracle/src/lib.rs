#![no_std]
#![allow(clippy::too_many_arguments)]
//! SubTrackr price oracle contract.
//!
//! A push-style oracle: authorized feed addresses submit signed price
//! observations for `(token, quote)` pairs, and subscription/billing contracts
//! read USD-equivalent prices through [`SubTrackrOracle::get_price`] and friends.
//!
//! Reliability features required for charging real money:
//! * **Caching with TTL** — [`get_price_with_cache`] avoids recomputation within a window.
//! * **Fallback oracle** — each feed may register a redundant source.
//! * **Circuit breaker** — repeated stale/deviating updates trip the feed until reset.
//! * **Staleness detection** — observations older than the configured window are rejected.
//! * **Multiple quote currencies** — pairs are keyed by `(token, quote)`.
//! * **Deviation thresholds** — out-of-band updates raise alerts and fault the breaker.
//!
//! [`get_price_with_cache`]: SubTrackrOracle::get_price_with_cache

mod price;

pub use price::{deviation_bps, is_stale, select_price, CircuitState, FeedConfig, Price, PriceSource};

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

/// Number of consecutive faults that trips a feed's circuit breaker.
const CIRCUIT_FAULT_LIMIT: u32 = 3;
/// How long (seconds) a tripped breaker stays open before auto half-opening.
const CIRCUIT_COOLDOWN_SECS: u64 = 3_600;
/// Maximum number of historical observations retained per feed.
const MAX_HISTORY: u32 = 64;

#[contracterror]
#[derive(Clone, Debug, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum OracleError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    FeedNotFound = 4,
    FeedExists = 5,
    InvalidPrice = 6,
    InvalidTimestamp = 7,
    NoPriceAvailable = 8,
    StalePrice = 9,
    CircuitOpen = 10,
    NoHistory = 11,
    InvalidConfig = 12,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Feed(Symbol, Symbol),
    Latest(Symbol, Symbol, PriceSource),
    Cache(Symbol, Symbol),
    Circuit(Symbol, Symbol),
    History(Symbol, Symbol),
}

#[contract]
pub struct SubTrackrOracle;

#[contractimpl]
impl SubTrackrOracle {
    /// One-time initialization recording the admin that may register feeds.
    pub fn initialize(env: Env, admin: Address) -> Result<(), OracleError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(OracleError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Registers (or replaces) a feed for a `(token, quote)` pair.
    ///
    /// `deviation_threshold_bps` is the inter-update tolerance in basis points;
    /// `max_staleness_secs` is the age after which observations are unusable.
    pub fn register_feed(
        env: Env,
        token: Symbol,
        quote: Symbol,
        primary: Address,
        fallback: Option<Address>,
        max_staleness_secs: u64,
        deviation_threshold_bps: u32,
        decimals: u32,
    ) -> Result<(), OracleError> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        if max_staleness_secs == 0 || decimals > 18 {
            return Err(OracleError::InvalidConfig);
        }
        let cfg = FeedConfig {
            token: token.clone(),
            quote: quote.clone(),
            primary,
            fallback,
            max_staleness_secs,
            deviation_threshold_bps,
            decimals,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Feed(token.clone(), quote.clone()), &cfg);
        env.storage()
            .persistent()
            .set(&DataKey::Circuit(token, quote), &CircuitState::closed());
        Ok(())
    }

    /// Submits a price observation. The caller must be the feed's registered
    /// primary or fallback address. Observations that deviate beyond the
    /// configured threshold raise an alert and fault the circuit breaker.
    pub fn submit_price(
        env: Env,
        source: Address,
        token: Symbol,
        quote: Symbol,
        value: i128,
        timestamp: u64,
    ) -> Result<(), OracleError> {
        source.require_auth();
        let cfg = Self::load_feed(&env, &token, &quote)?;

        let source_kind = if source == cfg.primary {
            PriceSource::Primary
        } else if cfg.fallback.as_ref() == Some(&source) {
            PriceSource::Fallback
        } else {
            return Err(OracleError::Unauthorized);
        };

        if value <= 0 {
            return Err(OracleError::InvalidPrice);
        }
        let now = env.ledger().timestamp();
        if timestamp > now {
            return Err(OracleError::InvalidTimestamp);
        }

        let prev = Self::latest(&env, &token, &quote, &source_kind);
        let observation = Price {
            token: token.clone(),
            quote: quote.clone(),
            value,
            decimals: cfg.decimals,
            timestamp,
            source: source_kind.clone(),
        };

        // Deviation check against the same source's previous value.
        let mut circuit = Self::circuit(&env, &token, &quote);
        if let Some(prev_price) = prev {
            let dev = deviation_bps(prev_price.value, value);
            if dev > cfg.deviation_threshold_bps {
                env.events().publish(
                    (symbol_short!("deviation"), token.clone(), quote.clone()),
                    (prev_price.value, value, dev),
                );
                circuit.consecutive_faults += 1;
                if circuit.consecutive_faults >= CIRCUIT_FAULT_LIMIT && !circuit.tripped {
                    circuit.tripped = true;
                    circuit.tripped_at = now;
                    env.events()
                        .publish((symbol_short!("breaker"), token.clone(), quote.clone()), now);
                }
            } else {
                circuit.consecutive_faults = 0;
            }
        }
        Self::save_circuit(&env, &token, &quote, &circuit);

        env.storage().persistent().set(
            &DataKey::Latest(token.clone(), quote.clone(), source_kind.clone()),
            &observation,
        );
        Self::push_history(&env, &token, &quote, &observation);
        env.events().publish(
            (symbol_short!("price"), token, quote),
            (value, timestamp, source_kind),
        );
        Ok(())
    }

    /// Returns the freshest valid price for a pair, applying staleness and
    /// circuit-breaker checks. Faults detected here feed the breaker.
    pub fn get_price(env: Env, token: Symbol, quote: Symbol) -> Result<Price, OracleError> {
        let cfg = Self::load_feed(&env, &token, &quote)?;
        let now = env.ledger().timestamp();
        let mut circuit = Self::circuit(&env, &token, &quote);

        if circuit.tripped {
            if now.saturating_sub(circuit.tripped_at) < CIRCUIT_COOLDOWN_SECS {
                return Err(OracleError::CircuitOpen);
            }
            // Cooldown elapsed: half-open the breaker and let this read probe it.
            circuit = CircuitState::closed();
            Self::save_circuit(&env, &token, &quote, &circuit);
        }

        let primary = Self::latest(&env, &token, &quote, &PriceSource::Primary);
        let fallback = Self::latest(&env, &token, &quote, &PriceSource::Fallback);
        let had_any = primary.is_some() || fallback.is_some();

        match select_price(now, cfg.max_staleness_secs, primary, fallback) {
            Some(price) => {
                if circuit.consecutive_faults != 0 {
                    circuit.consecutive_faults = 0;
                    Self::save_circuit(&env, &token, &quote, &circuit);
                }
                Ok(price)
            }
            None => {
                circuit.consecutive_faults += 1;
                if circuit.consecutive_faults >= CIRCUIT_FAULT_LIMIT {
                    circuit.tripped = true;
                    circuit.tripped_at = now;
                }
                Self::save_circuit(&env, &token, &quote, &circuit);
                if had_any {
                    Err(OracleError::StalePrice)
                } else {
                    Err(OracleError::NoPriceAvailable)
                }
            }
        }
    }

    /// Like [`get_price`](Self::get_price) but serves a cached aggregate when
    /// the last computed price is younger than `ttl` seconds, avoiding repeated
    /// staleness/deviation work for hot read paths.
    pub fn get_price_with_cache(
        env: Env,
        token: Symbol,
        quote: Symbol,
        ttl: u64,
    ) -> Result<Price, OracleError> {
        let now = env.ledger().timestamp();
        if let Some((cached, cached_at)) = env
            .storage()
            .persistent()
            .get::<_, (Price, u64)>(&DataKey::Cache(token.clone(), quote.clone()))
        {
            if now.saturating_sub(cached_at) <= ttl {
                return Ok(cached);
            }
        }
        let price = Self::get_price(env.clone(), token.clone(), quote.clone())?;
        env.storage()
            .persistent()
            .set(&DataKey::Cache(token, quote), &(price.clone(), now));
        Ok(price)
    }

    /// Returns the most recent observation recorded at or before `timestamp`.
    pub fn get_historical_price(
        env: Env,
        token: Symbol,
        quote: Symbol,
        timestamp: u64,
    ) -> Result<Price, OracleError> {
        let history = env
            .storage()
            .persistent()
            .get::<_, soroban_sdk::Vec<Price>>(&DataKey::History(token, quote))
            .ok_or(OracleError::NoHistory)?;
        let mut best: Option<Price> = None;
        let mut i = 0u32;
        while i < history.len() {
            let p = history.get(i).unwrap();
            if p.timestamp <= timestamp {
                match &best {
                    Some(b) if b.timestamp >= p.timestamp => {}
                    _ => best = Some(p),
                }
            }
            i += 1;
        }
        best.ok_or(OracleError::NoHistory)
    }

    /// Reads a feed's circuit-breaker state.
    pub fn get_circuit_state(
        env: Env,
        token: Symbol,
        quote: Symbol,
    ) -> Result<CircuitState, OracleError> {
        Self::load_feed(&env, &token, &quote)?;
        Ok(Self::circuit(&env, &token, &quote))
    }

    /// Admin-only manual reset of a tripped breaker.
    pub fn reset_circuit(env: Env, token: Symbol, quote: Symbol) -> Result<(), OracleError> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        Self::load_feed(&env, &token, &quote)?;
        Self::save_circuit(&env, &token, &quote, &CircuitState::closed());
        Ok(())
    }

    /// Reads a feed's configuration.
    pub fn get_feed(env: Env, token: Symbol, quote: Symbol) -> Result<FeedConfig, OracleError> {
        Self::load_feed(&env, &token, &quote)
    }

    // ---- internal helpers -------------------------------------------------

    fn require_admin(env: &Env) -> Result<Address, OracleError> {
        env.storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .ok_or(OracleError::NotInitialized)
    }

    fn load_feed(env: &Env, token: &Symbol, quote: &Symbol) -> Result<FeedConfig, OracleError> {
        env.storage()
            .persistent()
            .get::<_, FeedConfig>(&DataKey::Feed(token.clone(), quote.clone()))
            .ok_or(OracleError::FeedNotFound)
    }

    fn latest(env: &Env, token: &Symbol, quote: &Symbol, source: &PriceSource) -> Option<Price> {
        env.storage()
            .persistent()
            .get(&DataKey::Latest(token.clone(), quote.clone(), source.clone()))
    }

    fn circuit(env: &Env, token: &Symbol, quote: &Symbol) -> CircuitState {
        env.storage()
            .persistent()
            .get(&DataKey::Circuit(token.clone(), quote.clone()))
            .unwrap_or_else(CircuitState::closed)
    }

    fn save_circuit(env: &Env, token: &Symbol, quote: &Symbol, state: &CircuitState) {
        env.storage()
            .persistent()
            .set(&DataKey::Circuit(token.clone(), quote.clone()), state);
    }

    fn push_history(env: &Env, token: &Symbol, quote: &Symbol, price: &Price) {
        let key = DataKey::History(token.clone(), quote.clone());
        let mut history = env
            .storage()
            .persistent()
            .get::<_, soroban_sdk::Vec<Price>>(&key)
            .unwrap_or_else(|| soroban_sdk::Vec::new(env));
        history.push_back(price.clone());
        while history.len() > MAX_HISTORY {
            history.remove(0);
        }
        env.storage().persistent().set(&key, &history);
    }
}

#[cfg(test)]
mod test;
