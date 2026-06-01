/// Issue #395 – Transient Storage Regression Tests
///
/// These tests verify:
///   1. The temporary storage bridge methods work correctly.
///   2. Rate-limit timestamps stored via TmpLastCall expire after the TTL.
///   3. ProxyScheduledUpgrade stored in temporary storage behaves correctly.
///   4. No regression in the external API or state guarantees.
///
/// Run with:
///   cargo test -p subtrackr-storage -- transient --nocapture

#[cfg(test)]
mod transient_storage_tests {
    use crate::{SubTrackrStorage, SubTrackrStorageClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        Address, Env, IntoVal, String as SorobanString, TryFromVal,
    };
    use subtrackr_types::StorageKey;

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        // Configure a small minimum TTL for temporary entries so expiry is testable.
        env.ledger().set(LedgerInfo {
            min_temp_entry_ttl: 1,
            ..env.ledger().get()
        });

        let admin = Address::generate(&env);
        let implementation = Address::generate(&env);

        let contract_id = env.register_contract(None, SubTrackrStorage);
        let client = SubTrackrStorageClient::new(&env, &contract_id);
        client.initialize(&admin, &implementation);

        (env, contract_id, implementation)
    }

    // ── temporary_get / temporary_set ────────────────────────────────────────

    #[test]
    fn test_temporary_set_and_get_roundtrip() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        let caller = Address::generate(&env);
        let fname = SorobanString::from_str(&env, "subscribe");
        let key = StorageKey::TmpLastCall(caller.clone(), fname.clone());
        let timestamp: u64 = 1_000_000;

        // Write with a 12-ledger TTL (≈ 60 s)
        client.temporary_set(&key, &timestamp.into_val(&env), &12u32);

        let result: Option<u64> = client
            .temporary_get(&key)
            .map(|v| TryFromVal::try_from_val(&env, &v).unwrap());
        assert_eq!(result, Some(timestamp));
    }

    #[test]
    fn test_temporary_get_returns_none_for_missing_key() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        let caller = Address::generate(&env);
        let fname = SorobanString::from_str(&env, "nonexistent");
        let key = StorageKey::TmpLastCall(caller, fname);

        let result = client.temporary_get(&key);
        assert!(result.is_none());
    }

    #[test]
    fn test_temporary_remove_clears_entry() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        let caller = Address::generate(&env);
        let fname = SorobanString::from_str(&env, "cancel_subscription");
        let key = StorageKey::TmpLastCall(caller, fname);
        let ts: u64 = 999;

        client.temporary_set(&key, &ts.into_val(&env), &10u32);
        assert!(client.temporary_get(&key).is_some());

        client.temporary_remove(&key);
        assert!(client.temporary_get(&key).is_none());
    }

    // ── TTL expiry ────────────────────────────────────────────────────────────

    #[test]
    fn test_temporary_entry_expires_after_ttl() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        let caller = Address::generate(&env);
        let fname = SorobanString::from_str(&env, "create_plan");
        let key = StorageKey::TmpLastCall(caller, fname);
        let ts: u64 = 500;

        // Write with TTL = 5 ledgers.
        client.temporary_set(&key, &ts.into_val(&env), &5u32);
        assert!(
            client.temporary_get(&key).is_some(),
            "entry should exist before expiry"
        );

        // Advance ledger sequence past the TTL.
        env.ledger().set(LedgerInfo {
            sequence_number: env.ledger().sequence() + 6,
            ..env.ledger().get()
        });

        // After TTL the entry should be gone
        assert!(
            client.temporary_get(&key).is_none(),
            "entry should have expired after TTL"
        );
    }

    // ── TmpLastCall key isolation ─────────────────────────────────────────────

    #[test]
    fn test_tmp_last_call_keys_are_isolated_per_caller() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        let caller_a = Address::generate(&env);
        let caller_b = Address::generate(&env);
        let fname = SorobanString::from_str(&env, "subscribe");

        let key_a = StorageKey::TmpLastCall(caller_a.clone(), fname.clone());
        let key_b = StorageKey::TmpLastCall(caller_b.clone(), fname.clone());

        client.temporary_set(&key_a, &100u64.into_val(&env), &20u32);
        client.temporary_set(&key_b, &200u64.into_val(&env), &20u32);

        let val_a: u64 =
            soroban_sdk::TryFromVal::try_from_val(&env, &client.temporary_get(&key_a).unwrap())
                .unwrap();
        let val_b: u64 =
            soroban_sdk::TryFromVal::try_from_val(&env, &client.temporary_get(&key_b).unwrap())
                .unwrap();

        assert_eq!(val_a, 100);
        assert_eq!(val_b, 200);
    }

    #[test]
    fn test_tmp_last_call_keys_are_isolated_per_function() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        let caller = Address::generate(&env);
        let fname_a = SorobanString::from_str(&env, "subscribe");
        let fname_b = SorobanString::from_str(&env, "cancel_subscription");

        let key_a = StorageKey::TmpLastCall(caller.clone(), fname_a);
        let key_b = StorageKey::TmpLastCall(caller.clone(), fname_b);

        client.temporary_set(&key_a, &111u64.into_val(&env), &20u32);
        client.temporary_set(&key_b, &222u64.into_val(&env), &20u32);

        let val_a: u64 =
            soroban_sdk::TryFromVal::try_from_val(&env, &client.temporary_get(&key_a).unwrap())
                .unwrap();
        let val_b: u64 =
            soroban_sdk::TryFromVal::try_from_val(&env, &client.temporary_get(&key_b).unwrap())
                .unwrap();

        assert_eq!(val_a, 111);
        assert_eq!(val_b, 222);
    }

    // ── ProxyScheduledUpgrade in temporary storage ────────────────────────────

    #[test]
    fn test_proxy_scheduled_upgrade_stored_in_temporary() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        let new_impl = Address::generate(&env);
        let execute_after: u64 = env.ledger().timestamp() + 86_400; // +1 day

        let upgrade = subtrackr_types::ScheduledUpgrade {
            implementation: new_impl.clone(),
            execute_after,
        };

        let key = StorageKey::ProxyScheduledUpgrade;
        // TTL = 120 960 ledgers (≈ 7 days)
        client.temporary_set(&key, &upgrade.into_val(&env), &120_960u32);

        let stored: Option<subtrackr_types::ScheduledUpgrade> = client
            .temporary_get(&key)
            .map(|v| TryFromVal::try_from_val(&env, &v).unwrap());

        assert!(stored.is_some());
        let stored = stored.unwrap();
        assert_eq!(stored.implementation, new_impl);
        assert_eq!(stored.execute_after, execute_after);
    }

    #[test]
    fn test_proxy_scheduled_upgrade_cleared_after_execution() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        let new_impl = Address::generate(&env);
        let upgrade = subtrackr_types::ScheduledUpgrade {
            implementation: new_impl,
            execute_after: env.ledger().timestamp() + 3600,
        };

        let key = StorageKey::ProxyScheduledUpgrade;
        client.temporary_set(&key, &upgrade.into_val(&env), &120_960u32);
        assert!(client.temporary_get(&key).is_some());

        // Simulate upgrade execution: clear the entry
        client.temporary_remove(&key);
        assert!(client.temporary_get(&key).is_none());
    }

    // ── Persistent storage unaffected ─────────────────────────────────────────

    #[test]
    fn test_persistent_storage_unaffected_by_transient_changes() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        // Write a persistent value
        let plan_id: u64 = 1;
        let key = StorageKey::Plan(plan_id);
        // We can't easily write a full Plan here without the subscription crate,
        // so we write a simple u64 to verify the persistent bridge is unaffected.
        client.persistent_set(&key, &42u64.into_val(&env));

        // Write and remove a temporary value with the same numeric id
        let caller = Address::generate(&env);
        let fname = SorobanString::from_str(&env, "test");
        let tmp_key = StorageKey::TmpLastCall(caller, fname);
        client.temporary_set(&tmp_key, &99u64.into_val(&env), &5u32);
        client.temporary_remove(&tmp_key);

        // Persistent value must still be intact
        let persisted: Option<u64> = client
            .persistent_get(&key)
            .map(|v| TryFromVal::try_from_val(&env, &v).unwrap());
        assert_eq!(persisted, Some(42u64));
    }

    // ── Instance storage unaffected ───────────────────────────────────────────

    #[test]
    fn test_instance_storage_unaffected_by_transient_changes() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        // Admin is set during initialize() in instance storage
        let admin_from_instance = client.get_admin();

        // Write and expire a temporary entry
        let caller = Address::generate(&env);
        let fname = SorobanString::from_str(&env, "test_fn");
        let tmp_key = StorageKey::TmpLastCall(caller, fname);
        client.temporary_set(&tmp_key, &1u64.into_val(&env), &1u32);

        // Advance past TTL
        env.ledger().set(LedgerInfo {
            sequence_number: env.ledger().sequence() + 2,
            ..env.ledger().get()
        });

        // Admin in instance storage must be unchanged
        assert_eq!(client.get_admin(), admin_from_instance);
    }

    // ── secs_to_ledgers helper (unit test via public API) ─────────────────────

    #[test]
    fn test_minimum_ttl_is_one_ledger() {
        let (env, contract_id, _impl) = setup();
        let client = SubTrackrStorageClient::new(&env, &contract_id);

        let caller = Address::generate(&env);
        let fname = SorobanString::from_str(&env, "fn");
        let key = StorageKey::TmpLastCall(caller, fname);

        // TTL = 0 should be treated as 1 ledger (minimum)
        client.temporary_set(&key, &1u64.into_val(&env), &0u32);
        assert!(client.temporary_get(&key).is_some());
    }
}
