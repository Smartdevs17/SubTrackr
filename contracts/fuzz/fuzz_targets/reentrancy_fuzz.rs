#![no_main]
use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::{Env, MockAuth};

fuzz_target!(|data: (u64, i128)| {
    let (time_jump, malicious_transfer_amount) = data;
    let env = Env::default();
    
    // Initialize mock subscriber and malicious token contract
    let subscriber = env.register_contract(None, MockSubscriber);
    let token = env.register_contract(None, MaliciousToken::new(malicious_transfer_amount));
    
    // Jump ledger time to simulate billing cycle
    env.ledger().set_timestamp(env.ledger().timestamp() + time_jump);

    // Attempt charge. The malicious token will attempt a reentrant call back 
    // into `charge()` during `transfer_from`.
    // We catch the panic to ensure the ReentrancyGuard triggers correctly.
    let result = std::panic::catch_unwind(|| {
        subscription_contract::charge(&env, &subscriber);
    });

    // The guard should ALWAYS prevent the second internal execution.
    assert!(result.is_err(), "Reentrancy guard failed to panic on recursive call");
});