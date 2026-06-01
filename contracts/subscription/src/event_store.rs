use soroban_sdk::{contracttype, Address, Env, Vec};
use subtrackr_types::TimeRange;

use crate::events::{
    EventFilter, EventMetadata, EventRetentionPolicy, StoredEvent, SubscriptionEventType,
};
use crate::errors::ContractError;

const DEFAULT_MAX_EVENTS_PER_SUBSCRIPTION: u32 = 10_000;
const DEFAULT_RETENTION_DAYS: u64 = 365;
const MAX_EXPORT_WINDOW_DAYS: u64 = 365;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
enum EventStoreKey {
    EventCount,
    EventData(u64),
    SubEventsIndex(u64),
    MerchantEventsIndex(u64),
    RetentionConfig,
}

fn put<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: EventStoreKey,
    val: V,
) {
    env.storage().persistent().set(&key, &val);
}

fn get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: EventStoreKey,
) -> Option<V> {
    env.storage().persistent().get(&key)
}

/// Read event IDs for a subscription (used by state reconstruction).
pub(crate) fn read_event_ids(env: &Env, subscription_id: u64) -> Vec<u64> {
    get(env, EventStoreKey::SubEventsIndex(subscription_id))
        .unwrap_or(Vec::new(env))
}

/// Read a single event by ID (used by state reconstruction).
pub(crate) fn read_event(env: &Env, event_id: u64) -> Option<StoredEvent> {
    get(env, EventStoreKey::EventData(event_id))
}

fn next_event_id(env: &Env) -> u64 {
    let mut count: u64 =
        get(env, EventStoreKey::EventCount).unwrap_or(0);
    count += 1;
    put(env, EventStoreKey::EventCount, count);
    count
}

fn subscription_event_ids(env: &Env, subscription_id: u64) -> Vec<u64> {
    get(env, EventStoreKey::SubEventsIndex(subscription_id))
        .unwrap_or(Vec::new(env))
}

fn set_subscription_event_ids(env: &Env, subscription_id: u64, ids: Vec<u64>) {
    put(env, EventStoreKey::SubEventsIndex(subscription_id), ids);
}

fn merchant_event_ids(env: &Env, merchant_tag: u64) -> Vec<u64> {
    get(env, EventStoreKey::MerchantEventsIndex(merchant_tag))
        .unwrap_or(Vec::new(env))
}

fn set_merchant_event_ids(env: &Env, merchant_tag: u64, ids: Vec<u64>) {
    put(
        env,
        EventStoreKey::MerchantEventsIndex(merchant_tag),
        ids,
    );
}

fn default_retention_policy() -> EventRetentionPolicy {
    EventRetentionPolicy {
        max_events_per_subscription: DEFAULT_MAX_EVENTS_PER_SUBSCRIPTION,
        max_events_per_merchant: 0,
        retention_days: DEFAULT_RETENTION_DAYS,
        auto_prune_enabled: true,
    }
}

pub(crate) fn build_event_metadata(env: &Env, actor: &Address) -> EventMetadata {
    EventMetadata {
        timestamp: env.ledger().timestamp(),
        ledger_seq: env.ledger().sequence(),
        actor: actor.clone(),
    }
}

pub(crate) fn record_event(
    env: &Env,
    subscription_id: u64,
    merchant_tag: u64,
    event_type: SubscriptionEventType,
    metadata: EventMetadata,
    prior_status: &subtrackr_types::SubscriptionStatus,
    new_status: &subtrackr_types::SubscriptionStatus,
    plan_id: u64,
    amount: i128,
) -> u64 {
    let event_id = next_event_id(env);

    let event = StoredEvent {
        id: event_id,
        subscription_id,
        event_type,
        metadata,
        prior_status: prior_status.clone(),
        new_status: new_status.clone(),
        plan_id,
        amount,
        schema_version: 1,
    };

    put(env, EventStoreKey::EventData(event_id), event);

    let mut sub_ids = subscription_event_ids(env, subscription_id);
    sub_ids.push_back(event_id);
    set_subscription_event_ids(env, subscription_id, sub_ids);

    let mut merch_ids = merchant_event_ids(env, merchant_tag);
    merch_ids.push_back(event_id);
    set_merchant_event_ids(env, merchant_tag, merch_ids);

    if let Some(policy) = get_retention_policy(env) {
        if policy.auto_prune_enabled {
            prune_events(env, subscription_id, &policy);
        }
    }

    event_id
}

pub(crate) fn get_event(env: &Env, event_id: u64) -> Option<StoredEvent> {
    get(env, EventStoreKey::EventData(event_id))
}

pub(crate) fn get_events(env: &Env, filter: EventFilter) -> Vec<StoredEvent> {
    let event_ids: Vec<u64> = if let Some(sub_id) = filter.subscription_id {
        subscription_event_ids(env, sub_id)
    } else {
        return Vec::new(env);
    };

    let mut results: Vec<StoredEvent> = Vec::new(env);
    let total = event_ids.len();
    let start = filter.offset.min(total);
    let end = (start + filter.limit).min(total);

    let mut i = start;
    while i < end {
        let event_id = event_ids.get_unchecked(i);
        if let Some(event) = get_event(env, event_id) {
            let mut matched = true;

            if let Some(ref types) = filter.event_types {
                matched = types.iter().any(|t| *t == event.event_type);
            }

            if matched {
                if let Some(ref range) = filter.date_range {
                    matched = event.metadata.timestamp >= range.start
                        && event.metadata.timestamp <= range.end;
                }
            }

            if matched {
                if let Some(ref actor) = filter.actor {
                    matched = event.metadata.actor == *actor;
                }
            }

            if matched {
                results.push_back(event);
            }
        }
        i += 1;
    }

    results
}

pub(crate) fn get_event_count(env: &Env, subscription_id: u64) -> u64 {
    let ids = subscription_event_ids(env, subscription_id);
    ids.len()
}

pub(crate) fn export_events(
    env: &Env,
    merchant_tag: u64,
    range: TimeRange,
) -> Result<Vec<StoredEvent>, ContractError> {
    let window_days = (range.end - range.start) / 86400;
    if window_days > MAX_EXPORT_WINDOW_DAYS {
        return Err(ContractError::ExportWindowExceeded);
    }

    let event_ids = merchant_event_ids(env, merchant_tag);
    let mut results: Vec<StoredEvent> = Vec::new(env);

    let mut i = 0u32;
    while i < event_ids.len() {
        let event_id = event_ids.get_unchecked(i);
        if let Some(event) = get_event(env, event_id) {
            if event.metadata.timestamp >= range.start
                && event.metadata.timestamp <= range.end
            {
                results.push_back(event);
            }
        }
        i += 1;
    }

    Ok(results)
}

pub(crate) fn set_retention_policy(env: &Env, policy: EventRetentionPolicy) {
    put(env, EventStoreKey::RetentionConfig, policy);
}

pub(crate) fn get_retention_policy(env: &Env) -> Option<EventRetentionPolicy> {
    get(env, EventStoreKey::RetentionConfig)
        .or_else(|| Some(default_retention_policy()))
}

fn prune_events(env: &Env, subscription_id: u64, policy: &EventRetentionPolicy) {
    let mut ids = subscription_event_ids(env, subscription_id);
    let max = policy.max_events_per_subscription as u32;

    if ids.len() > max {
        let excess = ids.len() - max;
        let mut i = 0u32;
        while i < excess {
            let old_id = ids.get_unchecked(i);
            env.storage()
                .persistent()
                .remove(&EventStoreKey::EventData(old_id));
            i += 1;
        }

        let mut kept: Vec<u64> = Vec::new(env);
        let mut j = excess;
        while j < ids.len() {
            kept.push_back(ids.get_unchecked(j));
            j += 1;
        }
        set_subscription_event_ids(env, subscription_id, kept);
    }
}
