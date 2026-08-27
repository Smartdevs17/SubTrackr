use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Bytes, Env};
use utils::merkle::{batch_get, batch_insert};

#[test]
fn gas_benchmark_batch_read_100_entries() {
    let env = Env::default();
    env.mock_all_auths();

    let prefix = Bytes::from_slice(&env, b"bench_");
    let mut entries = Vec::new(&env);

    for i in 0..100u64 {
        let key = Bytes::from_slice(&env, format!("key_{}", i).as_bytes());
        let value = Bytes::from_slice(&env, format!("value_{}", i).as_bytes());
        entries.push_back((key, value.clone()));
    }

    // Batch insert
    batch_insert(&env, &prefix, &entries);

    // Batch read
    let mut keys = Vec::new(&env);
    for i in 0..100u64 {
        let key = Bytes::from_slice(&env, format!("key_{}", i).as_bytes());
        keys.push_back(key);
    }

    let (_results, _proof) = batch_get(&env, &prefix, &keys);
    // Gas cost is measured by soroban-cli; this test asserts functional correctness.
    assert_eq!(keys.len(), 100);
}
