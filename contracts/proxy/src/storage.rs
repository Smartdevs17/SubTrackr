use soroban_sdk::{Address, Env, Vec};
use subtrackr_types::{ScheduledUpgrade, StorageKey, UpgradeEvent};

pub(crate) fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&StorageKey::ProxyStorage)
}

pub(crate) fn admin(env: &Env) -> Address {
    let storage = storage_address(env);
    env.invoke_contract(
        &storage,
        &soroban_sdk::Symbol::new(env, "get_admin"),
        Vec::new(env),
    )
}

pub(crate) fn implementation(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::ProxyImplementation)
        .expect("Implementation not set")
}

pub(crate) fn set_implementation(env: &Env, implementation: &Address) {
    env.storage()
        .instance()
        .set(&StorageKey::ProxyImplementation, implementation);
}

pub(crate) fn storage_address(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::ProxyStorage)
        .expect("Storage address not set")
}

pub(crate) fn set_storage_address(env: &Env, storage: &Address) {
    env.storage()
        .instance()
        .set(&StorageKey::ProxyStorage, storage);
}

pub(crate) fn version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&StorageKey::ProxyVersion)
        .unwrap_or(0)
}

pub(crate) fn set_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&StorageKey::ProxyVersion, &version);
}

pub(crate) fn upgrade_delay_secs(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&StorageKey::ProxyUpgradeDelaySecs)
        .unwrap_or(0)
}

pub(crate) fn set_upgrade_delay_secs(env: &Env, delay_secs: u64) {
    env.storage()
        .instance()
        .set(&StorageKey::ProxyUpgradeDelaySecs, &delay_secs);
}

pub(crate) fn rollback_delay_secs(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&StorageKey::ProxyRollbackDelaySecs)
        .unwrap_or(0)
}

pub(crate) fn set_rollback_delay_secs(env: &Env, delay_secs: u64) {
    env.storage()
        .instance()
        .set(&StorageKey::ProxyRollbackDelaySecs, &delay_secs);
}

pub(crate) fn scheduled_upgrade(env: &Env) -> Option<ScheduledUpgrade> {
    // Issue #395: ProxyScheduledUpgrade is short-lived (exists only until the
    // upgrade is executed or cancelled) so temporary storage is appropriate.
    // We use a generous TTL of ~7 days (≈ 120 960 ledgers at 5 s/ledger) to
    // ensure the entry survives the upgrade delay window.
    env.storage()
        .temporary()
        .get(&StorageKey::ProxyScheduledUpgrade)
}

pub(crate) fn set_scheduled_upgrade(env: &Env, upgrade: &ScheduledUpgrade) {
    // TTL: 7 days in ledgers (7 * 24 * 3600 / 5 = 120 960).
    const UPGRADE_TTL_LEDGERS: u32 = 120_960;
    env.storage()
        .temporary()
        .set(&StorageKey::ProxyScheduledUpgrade, upgrade);
    env.storage().temporary().extend_ttl(
        &StorageKey::ProxyScheduledUpgrade,
        UPGRADE_TTL_LEDGERS,
        UPGRADE_TTL_LEDGERS,
    );
}

pub(crate) fn clear_scheduled_upgrade(env: &Env) {
    env.storage()
        .temporary()
        .remove(&StorageKey::ProxyScheduledUpgrade);
}

pub(crate) fn previous_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&StorageKey::ProxyPrevImplCount)
        .unwrap_or(0)
}

pub(crate) fn previous_top(env: &Env) -> Option<Address> {
    let count = previous_count(env);
    if count == 0 {
        return None;
    }
    env.storage()
        .instance()
        .get(&StorageKey::ProxyPreviousImplementation(count - 1))
}

pub(crate) fn push_previous(env: &Env, implementation: &Address) {
    let count = previous_count(env);
    env.storage().instance().set(
        &StorageKey::ProxyPreviousImplementation(count),
        implementation,
    );
    env.storage()
        .instance()
        .set(&StorageKey::ProxyPrevImplCount, &(count + 1));
}

pub(crate) fn swap_previous_top(env: &Env, new_top: &Address) -> Address {
    let count = previous_count(env);
    assert!(count > 0, "No previous implementation");
    let key = StorageKey::ProxyPreviousImplementation(count - 1);
    let old_top: Address = env
        .storage()
        .instance()
        .get(&key)
        .expect("Previous implementation missing");
    env.storage().instance().set(&key, new_top);
    old_top
}

pub(crate) fn history_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&StorageKey::ProxyUpgradeHistoryCount)
        .unwrap_or(0)
}

pub(crate) fn history_append(env: &Env, event: &UpgradeEvent) -> u32 {
    let idx = history_count(env);
    env.storage()
        .persistent()
        .set(&StorageKey::ProxyUpgradeHistoryEntry(idx), event);
    env.storage()
        .instance()
        .set(&StorageKey::ProxyUpgradeHistoryCount, &(idx + 1));
    idx
}

pub(crate) fn history_get(env: &Env, idx: u32) -> UpgradeEvent {
    env.storage()
        .persistent()
        .get(&StorageKey::ProxyUpgradeHistoryEntry(idx))
        .expect("Upgrade event not found")
}
