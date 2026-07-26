#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    Address, Env, String, Symbol, Vec,
};

const DEFAULT_UPTIME_TARGET_BPS: u32 = 9_900;
const DEFAULT_MEASUREMENT_INTERVAL_SECS: u64 = 604_800;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum AvailabilityState {
    Healthy,
    PartialOutage,
    FullOutage,
    Maintenance,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SLAConfig {
    pub uptime_target_bps: u32,
    pub measurement_interval: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AvailabilitySample {
    pub id: u64,
    pub merchant_id: Address,
    pub timestamp: u64,
    pub duration_secs: u64,
    pub state: AvailabilityState,
    pub note: String,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SLABreach {
    pub id: u64,
    pub merchant_id: Address,
    pub detected_at: u64,
    pub uptime_target_bps: u32,
    pub uptime_bps: u32,
    pub measurement_interval: u64,
    pub observed_seconds: u64,
    pub downtime_seconds: u64,
    pub partial_outage_seconds: u64,
    pub maintenance_seconds: u64,
    pub credit_amount: i128,
    pub resolved_at: u64,
    pub acknowledged: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SLAStatus {
    pub merchant_id: Address,
    pub uptime_target_bps: u32,
    pub measurement_interval: u64,
    pub observed_seconds: u64,
    pub uptime_bps: u32,
    pub downtime_seconds: u64,
    pub partial_outage_seconds: u64,
    pub maintenance_seconds: u64,
    pub breach_count: u64,
    pub active_breach_id: u64,
    pub credit_balance: i128,
    pub compliant: bool,
    pub last_updated_at: u64,
    pub last_breach_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DataKey {
    Admin,
    Config(Address),
    Status(Address),
    SampleCount(Address),
    Sample(Address, u64),
    BreachCount,
    Breach(u64),
    ActiveBreach(Address),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Metrics {
    pub observed_seconds: u64,
    pub downtime_seconds: u64,
    pub partial_outage_seconds: u64,
    pub maintenance_seconds: u64,
    pub uptime_bps: u32,
}

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Admin not set")
}

fn read_config(env: &Env, merchant_id: &Address) -> Option<SLAConfig> {
    env.storage().instance().get(&DataKey::Config(merchant_id.clone()))
}

fn read_breach(env: &Env, breach_id: u64) -> Option<SLABreach> {
    env.storage().instance().get(&DataKey::Breach(breach_id))
}

fn calculate_impact(sample: &AvailabilitySample) -> (u64, u64, u64) {
    match sample.state {
        AvailabilityState::Healthy => (0, 0, 0),
        AvailabilityState::Maintenance => (0, 0, sample.duration_secs),
        AvailabilityState::PartialOutage => (sample.duration_secs / 2, sample.duration_secs, 0),
        AvailabilityState::FullOutage => (sample.duration_secs, 0, 0),
    }
}

fn calculate_credit_amount(status: &SLAStatus) -> i128 {
    if status.uptime_bps >= status.uptime_target_bps {
        return 0;
    }

    let deficit_bps = (status.uptime_target_bps - status.uptime_bps) as i128;
    let severity = (status.downtime_seconds + status.partial_outage_seconds / 2) as i128;
    let window = status.measurement_interval.max(1) as i128;
    ((deficit_bps * severity * 100) / window).max(1)
}

fn merchant_samples(env: &Env, merchant_id: &Address) -> Vec<AvailabilitySample> {
    let count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::SampleCount(merchant_id.clone()))
        .unwrap_or(0);
    let mut samples = Vec::new(env);
    let mut i = 1;
    while i <= count {
        if let Some(sample) = env
            .storage()
            .instance()
            .get(&DataKey::Sample(merchant_id.clone(), i))
        {
            samples.push_back(sample);
        }
        i += 1;
    }
    samples
}

fn merchant_breaches(env: &Env, merchant_id: &Address) -> Vec<SLABreach> {
    let count: u64 = env.storage().instance().get(&DataKey::BreachCount).unwrap_or(0);
    let mut breaches = Vec::new(env);
    let mut i = 1;
    while i <= count {
        let breach: Option<SLABreach> = env.storage().instance().get(&DataKey::Breach(i));
        if let Some(breach) = breach {
            if breach.merchant_id == *merchant_id {
                breaches.push_back(breach);
            }
        }
        i += 1;
    }
    breaches
}

fn calculate_metrics(env: &Env, config: &SLAConfig, merchant_id: &Address) -> Metrics {
    let now = env.ledger().timestamp();
    let window_start = now.saturating_sub(config.measurement_interval);
    let samples = merchant_samples(env, merchant_id);

    let mut observed_seconds = 0u64;
    let mut downtime_seconds = 0u64;
    let mut partial_outage_seconds = 0u64;
    let mut maintenance_seconds = 0u64;

    for sample in samples.iter() {
        let sample_start = sample.timestamp;
        let sample_end = sample.timestamp.saturating_add(sample.duration_secs);
        if sample_end <= window_start || sample_start >= now {
            continue;
        }

        let overlap_start = sample_start.max(window_start);
        let overlap_end = sample_end.min(now);
        if overlap_end <= overlap_start {
            continue;
        }

        let overlap = overlap_end - overlap_start;
        let overlap_sample = AvailabilitySample {
            id: sample.id,
            merchant_id: sample.merchant_id.clone(),
            timestamp: overlap_start,
            duration_secs: overlap,
            state: sample.state.clone(),
            note: sample.note.clone(),
        };
        let (downtime, partial, maintenance) = calculate_impact(&overlap_sample);
        observed_seconds += overlap;
        downtime_seconds += downtime;
        partial_outage_seconds += partial;
        maintenance_seconds += maintenance;
    }

    let uptime_bps = if observed_seconds == 0 {
        10_000
    } else {
        let downtime_bps = ((downtime_seconds as u128 * 10_000) / observed_seconds as u128) as u32;
        10_000u32.saturating_sub(downtime_bps)
    };

    Metrics {
        observed_seconds,
        downtime_seconds,
        partial_outage_seconds,
        maintenance_seconds,
        uptime_bps,
    }
}

fn upsert_status(env: &Env, merchant_id: &Address, config: &SLAConfig) -> (SLAStatus, Option<SLABreach>) {
    let metrics = calculate_metrics(env, config, merchant_id);
    let now = env.ledger().timestamp();
    let breaches = merchant_breaches(env, merchant_id);
    let mut active_breach: Option<SLABreach> = None;
    for breach in breaches.iter().rev() {
        if breach.resolved_at == 0 {
            active_breach = Some(breach.clone());
            break;
        }
    }

    let mut status = SLAStatus {
        merchant_id: merchant_id.clone(),
        uptime_target_bps: config.uptime_target_bps,
        measurement_interval: config.measurement_interval,
        observed_seconds: metrics.observed_seconds,
        uptime_bps: metrics.uptime_bps,
        downtime_seconds: metrics.downtime_seconds,
        partial_outage_seconds: metrics.partial_outage_seconds,
        maintenance_seconds: metrics.maintenance_seconds,
        breach_count: breaches.len() as u64,
        active_breach_id: active_breach.as_ref().map(|breach| breach.id).unwrap_or(0),
        credit_balance: breaches.iter().map(|breach| breach.credit_amount).sum(),
        compliant: metrics.uptime_bps >= config.uptime_target_bps,
        last_updated_at: now,
        last_breach_at: breaches.iter().map(|breach| breach.detected_at).max().unwrap_or(0),
    };

    if status.compliant {
        if let Some(open_breach) = active_breach {
            let mut resolved = open_breach.clone();
            resolved.resolved_at = now;
            env.storage()
                .instance()
                .set(&DataKey::Breach(resolved.id), &resolved);
            status.active_breach_id = 0;
            return (status, None);
        }
        return (status, None);
    }

    if active_breach.is_some() {
        return (status, None);
    }

    let breach_id: u64 = env.storage().instance().get(&DataKey::BreachCount).unwrap_or(0) + 1;
    let credit_amount = calculate_credit_amount(&status);
    let breach = SLABreach {
        id: breach_id,
        merchant_id: merchant_id.clone(),
        detected_at: now,
        uptime_target_bps: status.uptime_target_bps,
        uptime_bps: status.uptime_bps,
        measurement_interval: status.measurement_interval,
        observed_seconds: status.observed_seconds,
        downtime_seconds: status.downtime_seconds,
        partial_outage_seconds: status.partial_outage_seconds,
        maintenance_seconds: status.maintenance_seconds,
        credit_amount,
        resolved_at: 0,
        acknowledged: false,
    };

    env.storage().instance().set(&DataKey::BreachCount, &breach_id);
    env.storage().instance().set(&DataKey::Breach(breach_id), &breach);
    status.breach_count += 1;
    status.active_breach_id = breach_id;
    status.credit_balance += credit_amount;
    status.last_breach_at = now;

    env.events().publish(
        (Symbol::new(env, "sla_breach"), merchant_id.clone()),
        (breach_id, status.uptime_bps, credit_amount),
    );

    (status, Some(breach))
}

#[contract]
pub struct SlaMonitoring;

#[contractimpl]
impl SlaMonitoring {
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn configure_sla(env: Env, merchant_id: Address, config: SLAConfig) {
        let admin = get_admin(&env);
        admin.require_auth();

        let normalized = SLAConfig {
            uptime_target_bps: config.uptime_target_bps.min(10_000).max(1),
            measurement_interval: config.measurement_interval.max(1),
        };
        env.storage()
            .instance()
            .set(&DataKey::Config(merchant_id.clone()), &normalized);

        let (status, _) = upsert_status(&env, &merchant_id, &normalized);
        env.storage().instance().set(&DataKey::Status(merchant_id), &status);
    }

    pub fn record_service_availability(
        env: Env,
        merchant_id: Address,
        duration_secs: u64,
        state: AvailabilityState,
        note: String,
    ) {
        let config: SLAConfig = read_config(&env, &merchant_id).unwrap_or(SLAConfig {
            uptime_target_bps: DEFAULT_UPTIME_TARGET_BPS,
            measurement_interval: DEFAULT_MEASUREMENT_INTERVAL_SECS,
        });
        let next_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::SampleCount(merchant_id.clone()))
            .unwrap_or(0)
            + 1;
        let sample = AvailabilitySample {
            id: next_id,
            merchant_id: merchant_id.clone(),
            timestamp: env.ledger().timestamp(),
            duration_secs: duration_secs.max(1),
            state,
            note,
        };

        env.storage()
            .instance()
            .set(&DataKey::SampleCount(merchant_id.clone()), &next_id);
        env.storage()
            .instance()
            .set(&DataKey::Sample(merchant_id.clone(), next_id), &sample);

        let (status, _) = upsert_status(&env, &merchant_id, &config);
        env.storage().instance().set(&DataKey::Status(merchant_id), &status);
    }

    pub fn detect_sla_breach(env: Env, merchant_id: Address) {
        let config: SLAConfig = read_config(&env, &merchant_id).unwrap_or(SLAConfig {
            uptime_target_bps: DEFAULT_UPTIME_TARGET_BPS,
            measurement_interval: DEFAULT_MEASUREMENT_INTERVAL_SECS,
        });
        let (status, _) = upsert_status(&env, &merchant_id, &config);
        env.storage().instance().set(&DataKey::Status(merchant_id), &status);
    }

    pub fn get_sla_status(env: Env, merchant_id: Address) -> SLAStatus {
        let config = read_config(&env, &merchant_id).unwrap_or(SLAConfig {
            uptime_target_bps: DEFAULT_UPTIME_TARGET_BPS,
            measurement_interval: DEFAULT_MEASUREMENT_INTERVAL_SECS,
        });
        let (status, _) = upsert_status(&env, &merchant_id, &config);
        env.storage().instance().set(&DataKey::Status(merchant_id), &status);
        status
    }

    pub fn get_sla_breaches(env: Env, merchant_id: Address) -> Vec<SLABreach> {
        merchant_breaches(&env, &merchant_id)
    }

    pub fn get_sla_breach(env: Env, breach_id: u64) -> SLABreach {
        read_breach(&env, breach_id).expect("Breach not found")
    }

    pub fn calculate_credit(env: Env, breach_id: u64) -> i128 {
        let breach = read_breach(&env, breach_id).expect("Breach not found");
        breach.credit_amount
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    struct Setup {
        env: Env,
        contract_id: Address,
        merchant: Address,
    }

    impl Setup {
        fn client(&self) -> SlaMonitoringClient<'_> {
            SlaMonitoringClient::new(&self.env, &self.contract_id)
        }
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().set_timestamp(1_700_000_000);
        let admin = Address::generate(&env);
        let merchant = Address::generate(&env);
        let contract_id = env.register_contract(None, SlaMonitoring);
        let client = SlaMonitoringClient::new(&env, &contract_id);
        client.initialize(&admin);
        Setup {
            env,
            contract_id,
            merchant,
        }
    }

    #[test]
    fn config_and_status_start_compliant() {
        let setup = setup();
        let config = SLAConfig {
            uptime_target_bps: 9_950,
            measurement_interval: 86_400,
        };

        setup.client().configure_sla(&setup.merchant, &config);
        let status = setup.client().get_sla_status(&setup.merchant);

        assert!(status.compliant);
        assert_eq!(status.uptime_bps, 10_000);
        assert_eq!(status.active_breach_id, 0);
    }

    #[test]
    fn breach_detection_records_credit_and_notification_event() {
        let setup = setup();
        let config = SLAConfig {
            uptime_target_bps: 9_950,
            measurement_interval: 86_400,
        };
        setup.client().configure_sla(&setup.merchant, &config);

        setup.env.ledger().set_timestamp(1_700_000_600);
        setup.client().record_service_availability(
            &setup.merchant,
            &3_600,
            &AvailabilityState::FullOutage,
            &String::from_str(&setup.env, "incident"),
        );

        setup.env.ledger().set_timestamp(1_700_004_200);
        let status = setup.client().get_sla_status(&setup.merchant);
        assert!(!status.compliant);
        assert!(status.active_breach_id > 0);

        let breach = setup.client().get_sla_breach(&status.active_breach_id);
        assert!(breach.credit_amount > 0);
        assert_eq!(setup.client().calculate_credit(&breach.id), breach.credit_amount);
    }

    #[test]
    fn maintenance_does_not_count_as_downtime() {
        let setup = setup();
        let config = SLAConfig {
            uptime_target_bps: 9_900,
            measurement_interval: 86_400,
        };
        setup.client().configure_sla(&setup.merchant, &config);

        setup.env.ledger().set_timestamp(1_700_001_000);
        setup.client().record_service_availability(
            &setup.merchant,
            &3_600,
            &AvailabilityState::Maintenance,
            &String::from_str(&setup.env, "scheduled"),
        );

        setup.env.ledger().set_timestamp(1_700_004_600);
        let status = setup.client().get_sla_status(&setup.merchant);
        assert!(status.compliant);
        assert_eq!(status.downtime_seconds, 0);
        assert_eq!(status.maintenance_seconds, 3_600);
    }
}
