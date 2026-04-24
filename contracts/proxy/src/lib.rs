#![no_std]

mod storage;

use soroban_sdk::{Address, Env, IntoVal, String, TryFromVal, Val, Vec};
use storage as proxy_storage;
use subtrackr_types::{
    Interval, Plan, ScheduledUpgrade, StorageKey, Subscription, Timestamp, UpgradeAction,
    UpgradeEvent,
};

fn current_proxy_address(env: &Env) -> Address {
    env.current_contract_address()
}

fn invoke_impl<T: TryFromVal<Env, Val>>(
    env: &Env,
    func: &str,
    args: Vec<Val>,
) -> T {
    let impl_addr = proxy_storage::implementation(env);
    env.invoke_contract(&impl_addr, &soroban_sdk::Symbol::new(env, func), args)
}

fn append_history(
    env: &Env,
    action: UpgradeAction,
    old_implementation: Address,
    new_implementation: Address,
    version_before: u32,
    version_after: u32,
    scheduled_for: Timestamp,
    executed_at: Timestamp,
) {
    let event = UpgradeEvent {
        action,
        old_implementation,
        new_implementation,
        version_before,
        version_after,
        scheduled_for,
        executed_at,
    };
    proxy_storage::history_append(env, &event);
}

#[soroban_sdk::contract]
pub struct UpgradeableProxy;

#[soroban_sdk::contractimpl]
impl UpgradeableProxy {
    // ── Initialization ──

    pub fn initialize(
        env: Env,
        admin: Address,
        storage: Address,
        implementation: Address,
        upgrade_delay_secs: u64,
        rollback_delay_secs: u64,
    ) {
        if proxy_storage::is_initialized(&env) {
            panic!("Already initialized");
        }
        admin.require_auth();

        // Configure proxy metadata.
        proxy_storage::set_storage_address(&env, &storage);
        proxy_storage::set_implementation(&env, &implementation);
        proxy_storage::set_upgrade_delay_secs(&env, upgrade_delay_secs);
        proxy_storage::set_rollback_delay_secs(&env, rollback_delay_secs);
        env.storage()
            .instance()
            .set(&StorageKey::ProxyPreviousImplementationCount, &0u32);
        env.storage()
            .instance()
            .set(&StorageKey::ProxyUpgradeHistoryCount, &0u32);

        // Initialize state storage.
        env.invoke_contract::<()>(
            &storage,
            &soroban_sdk::Symbol::new(&env, "initialize"),
            soroban_sdk::vec![
                &env,
                admin.into_val(&env),
                implementation.clone().into_val(&env)
            ],
        );

        // Record current storage schema version from the implementation.
        let proxy_addr = current_proxy_address(&env);
        let target_version: u32 = env.invoke_contract(
            &implementation,
            &soroban_sdk::Symbol::new(&env, "get_version"),
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage.into_val(&env)
            ],
        );
        proxy_storage::set_version(&env, target_version);
    }

    // ── Upgrade management ──

    /// Convenience wrapper: schedules an upgrade for `now + upgrade_delay_secs`.
    pub fn authorize_upgrade(env: Env, admin: Address, new_implementation: Address) {
        let stored_admin = proxy_storage::admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();

        let now = env.ledger().timestamp();
        let delay = proxy_storage::upgrade_delay_secs(&env);
        let execute_after = now + delay;
        Self::schedule_upgrade(env, new_implementation, execute_after);
    }

    pub fn schedule_upgrade(env: Env, implementation: Address, execute_after: Timestamp) {
        let admin = proxy_storage::admin(&env);
        admin.require_auth();

        if proxy_storage::scheduled_upgrade(&env).is_some() {
            panic!("Upgrade already scheduled");
        }

        let now = env.ledger().timestamp();
        let min_execute = now + proxy_storage::upgrade_delay_secs(&env);
        assert!(execute_after >= min_execute, "Upgrade delay not satisfied");

        let current_impl = proxy_storage::implementation(&env);
        assert!(implementation != current_impl, "Implementation unchanged");

        // Basic interface validation: ensure new implementation supports expected interface.
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        let args: Vec<Val> = soroban_sdk::vec![
            &env,
            proxy_addr.into_val(&env),
            storage_addr.into_val(&env)
        ];
        let _target_version: u32 =
            env.invoke_contract(&implementation, &soroban_sdk::Symbol::new(&env, "get_version"), args);

        proxy_storage::set_scheduled_upgrade(
            &env,
            &ScheduledUpgrade {
                implementation: implementation.clone(),
                execute_after,
            },
        );

        append_history(
            &env,
            UpgradeAction::Scheduled,
            current_impl,
            implementation,
            proxy_storage::version(&env),
            proxy_storage::version(&env),
            execute_after,
            0,
        );
    }

    pub fn cancel_scheduled_upgrade(env: Env) {
        let admin = proxy_storage::admin(&env);
        admin.require_auth();

        let scheduled = proxy_storage::scheduled_upgrade(&env).expect("No upgrade scheduled");
        let now = env.ledger().timestamp();

        proxy_storage::clear_scheduled_upgrade(&env);

        append_history(
            &env,
            UpgradeAction::Cancelled,
            proxy_storage::implementation(&env),
            scheduled.implementation,
            proxy_storage::version(&env),
            proxy_storage::version(&env),
            scheduled.execute_after,
            now,
        );
    }

    /// Execute a scheduled upgrade once the timelock has expired.
    pub fn upgrade_to(env: Env, implementation: Address) {
        let admin = proxy_storage::admin(&env);
        admin.require_auth();

        let scheduled = proxy_storage::scheduled_upgrade(&env).expect("No upgrade scheduled");
        assert!(
            scheduled.implementation == implementation,
            "Scheduled implementation mismatch"
        );

        let now = env.ledger().timestamp();
        assert!(now >= scheduled.execute_after, "Upgrade timelock not expired");

        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        let old_impl = proxy_storage::implementation(&env);
        let current_version = proxy_storage::version(&env);

        // Ensure the state storage only accepts writes from the target implementation.
        env.invoke_contract::<()>(
            &storage_addr,
            &soroban_sdk::Symbol::new(&env, "set_implementation"),
            soroban_sdk::vec![
                &env,
                admin.clone().into_val(&env),
                implementation.clone().into_val(&env)
            ],
        );

        let is_rollback = proxy_storage::previous_top(&env)
            .map(|prev| prev == implementation)
            .unwrap_or(false);

        // Update previous-implementation stack.
        if is_rollback {
            // Swap top with current implementation to allow emergency "roll-forward" if needed.
            proxy_storage::swap_previous_top(&env, &old_impl);
        } else {
            proxy_storage::push_previous(&env, &old_impl);
        }

        // Switch implementation.
        proxy_storage::set_implementation(&env, &implementation);

        // For rollbacks we don't run migrations, since storage was not reverted.
        let mut version_after = current_version;
        if !is_rollback {
            // Ask the new implementation which storage version it expects after migration.
            let target_version: u32 = env.invoke_contract(
                &implementation,
                &soroban_sdk::Symbol::new(&env, "get_version"),
                soroban_sdk::vec![
                    &env,
                    proxy_addr.clone().into_val(&env),
                    storage_addr.clone().into_val(&env)
                ],
            );
            assert!(
                target_version >= current_version,
                "Target version behind current"
            );

            // Validate upgrade compatibility and run migrations if needed.
            env.invoke_contract::<()>(
                &implementation,
                &soroban_sdk::Symbol::new(&env, "validate_upgrade"),
                soroban_sdk::vec![
                    &env,
                    proxy_addr.clone().into_val(&env),
                    storage_addr.clone().into_val(&env),
                    current_version.into_val(&env)
                ],
            );

            if target_version > current_version {
                env.invoke_contract::<()>(
                    &implementation,
                    &soroban_sdk::Symbol::new(&env, "migrate"),
                    soroban_sdk::vec![
                        &env,
                        proxy_addr.clone().into_val(&env),
                        storage_addr.clone().into_val(&env),
                        current_version.into_val(&env)
                    ],
                );
                proxy_storage::set_version(&env, target_version);
                version_after = target_version;
            }
        }

        proxy_storage::clear_scheduled_upgrade(&env);

        append_history(
            &env,
            if is_rollback {
                UpgradeAction::RolledBack
            } else {
                UpgradeAction::Executed
            },
            old_impl,
            implementation,
            current_version,
            version_after,
            scheduled.execute_after,
            now,
        );
    }

    /// Schedules a rollback to the immediately-previous implementation with the rollback delay.
    pub fn rollback(env: Env) -> Timestamp {
        let admin = proxy_storage::admin(&env);
        admin.require_auth();

        if proxy_storage::scheduled_upgrade(&env).is_some() {
            panic!("Upgrade already scheduled");
        }

        let prev = proxy_storage::previous_top(&env).expect("No previous implementation");
        let now = env.ledger().timestamp();
        let execute_after = now + proxy_storage::rollback_delay_secs(&env);

        proxy_storage::set_scheduled_upgrade(
            &env,
            &ScheduledUpgrade {
                implementation: prev.clone(),
                execute_after,
            },
        );

        append_history(
            &env,
            UpgradeAction::Scheduled,
            proxy_storage::implementation(&env),
            prev,
            proxy_storage::version(&env),
            proxy_storage::version(&env),
            execute_after,
            0,
        );

        execute_after
    }

    // ── Upgrade queries ──

    pub fn get_implementation(env: Env) -> Address {
        proxy_storage::implementation(&env)
    }

    pub fn get_version(env: Env) -> u32 {
        proxy_storage::version(&env)
    }

    pub fn get_scheduled_upgrade(env: Env) -> Option<ScheduledUpgrade> {
        proxy_storage::scheduled_upgrade(&env)
    }

    pub fn get_upgrade_history_count(env: Env) -> u32 {
        proxy_storage::history_count(&env)
    }

    pub fn get_upgrade_history_entry(env: Env, index: u32) -> UpgradeEvent {
        proxy_storage::history_get(&env, index)
    }

    // ── Subscription API (delegated) ──

    pub fn set_rate_limit(env: Env, function: String, min_interval_secs: u64) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "set_rate_limit",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                function.into_val(&env),
                min_interval_secs.into_val(&env)
            ],
        );
    }

    pub fn remove_rate_limit(env: Env, function: String) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "remove_rate_limit",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                function.into_val(&env)
            ],
        );
    }

    pub fn create_plan(
        env: Env,
        merchant: Address,
        name: String,
        price: i128,
        token: Address,
        interval: Interval,
    ) -> u64 {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl(
            &env,
            "create_plan",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                merchant.into_val(&env),
                name.into_val(&env),
                price.into_val(&env),
                token.into_val(&env),
                interval.into_val(&env)
            ],
        )
    }

    pub fn deactivate_plan(env: Env, merchant: Address, plan_id: u64) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "deactivate_plan",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                merchant.into_val(&env),
                plan_id.into_val(&env)
            ],
        );
    }

    pub fn subscribe(env: Env, subscriber: Address, plan_id: u64) -> u64 {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl(
            &env,
            "subscribe",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscriber.into_val(&env),
                plan_id.into_val(&env)
            ],
        )
    }

    pub fn cancel_subscription(env: Env, subscriber: Address, subscription_id: u64) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "cancel_subscription",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscriber.into_val(&env),
                subscription_id.into_val(&env)
            ],
        );
    }

    pub fn pause_subscription(env: Env, subscriber: Address, subscription_id: u64) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "pause_subscription",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscriber.into_val(&env),
                subscription_id.into_val(&env)
            ],
        );
    }

    pub fn pause_by_subscriber(
        env: Env,
        subscriber: Address,
        subscription_id: u64,
        duration: u64,
    ) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "pause_by_subscriber",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscriber.into_val(&env),
                subscription_id.into_val(&env),
                duration.into_val(&env)
            ],
        );
    }

    pub fn resume_subscription(env: Env, subscriber: Address, subscription_id: u64) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "resume_subscription",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscriber.into_val(&env),
                subscription_id.into_val(&env)
            ],
        );
    }

    pub fn charge_subscription(env: Env, subscription_id: u64) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "charge_subscription",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscription_id.into_val(&env)
            ],
        );
    }

    pub fn request_refund(env: Env, subscription_id: u64, amount: i128) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "request_refund",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscription_id.into_val(&env),
                amount.into_val(&env)
            ],
        );
    }

    pub fn approve_refund(env: Env, subscription_id: u64) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "approve_refund",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscription_id.into_val(&env)
            ],
        );
    }

    pub fn reject_refund(env: Env, subscription_id: u64) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "reject_refund",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscription_id.into_val(&env)
            ],
        );
    }

    pub fn request_transfer(env: Env, subscription_id: u64, recipient: Address) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "request_transfer",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscription_id.into_val(&env),
                recipient.into_val(&env)
            ],
        );
    }

    pub fn accept_transfer(env: Env, subscription_id: u64, recipient: Address) {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl::<()>(
            &env,
            "accept_transfer",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscription_id.into_val(&env),
                recipient.into_val(&env)
            ],
        );
    }

    pub fn get_plan(env: Env, plan_id: u64) -> Plan {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl(
            &env,
            "get_plan",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                plan_id.into_val(&env)
            ],
        )
    }

    pub fn get_subscription(env: Env, subscription_id: u64) -> Subscription {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl(
            &env,
            "get_subscription",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscription_id.into_val(&env)
            ],
        )
    }

    pub fn get_user_subscriptions(env: Env, subscriber: Address) -> Vec<u64> {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl(
            &env,
            "get_user_subscriptions",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                subscriber.into_val(&env)
            ],
        )
    }

    pub fn get_merchant_plans(env: Env, merchant: Address) -> Vec<u64> {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl(
            &env,
            "get_merchant_plans",
            soroban_sdk::vec![
                &env,
                proxy_addr.into_val(&env),
                storage_addr.into_val(&env),
                merchant.into_val(&env)
            ],
        )
    }

    pub fn get_plan_count(env: Env) -> u64 {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl(
            &env,
            "get_plan_count",
            soroban_sdk::vec![&env, proxy_addr.into_val(&env), storage_addr.into_val(&env)],
        )
    }

    pub fn get_subscription_count(env: Env) -> u64 {
        let proxy_addr = current_proxy_address(&env);
        let storage_addr = proxy_storage::storage_address(&env);
        invoke_impl(
            &env,
            "get_subscription_count",
            soroban_sdk::vec![&env, proxy_addr.into_val(&env), storage_addr.into_val(&env)],
        )
    }
}
