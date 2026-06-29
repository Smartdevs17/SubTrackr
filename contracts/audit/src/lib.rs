#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AnchorEntry {
    pub chain_head_hash: String,
    pub chain_length: u64,
    pub timestamp: u64,
    pub anchor_nonce: u64,
}

#[contracttype]
pub enum AuditDataKey {
    AnchorCount,
    Anchor(u64),
}

const MAX_ANCHORS: u64 = 1_000_000;

#[contract]
pub struct AuditContract;

#[contractimpl]
impl AuditContract {
    pub fn initialize(env: Env) {
        if env.storage().instance().has(&AuditDataKey::AnchorCount) {
            panic!("already initialized");
        }
        env.storage().instance().set(&AuditDataKey::AnchorCount, &0u64);
    }

    pub fn anchor(
        env: Env,
        chain_head_hash: String,
        chain_length: u64,
    ) -> AnchorEntry {
        let mut count: u64 = env
            .storage()
            .instance()
            .get(&AuditDataKey::AnchorCount)
            .unwrap_or(0);

        if count >= MAX_ANCHORS {
            panic!("anchor storage full");
        }

        let entry = AnchorEntry {
            chain_head_hash,
            chain_length,
            timestamp: env.ledger().timestamp(),
            anchor_nonce: count + 1,
        };

        count += 1;
        env.storage().instance().set(&AuditDataKey::AnchorCount, &count);
        env.storage().instance().set(&AuditDataKey::Anchor(count), &entry);

        env.events().publish(
            symbol_short!("anchor"),
            (entry.anchor_nonce, entry.chain_head_hash.clone()),
        );

        entry
    }

    pub fn get_anchor(env: Env, nonce: u64) -> Option<AnchorEntry> {
        env.storage().instance().get(&AuditDataKey::Anchor(nonce))
    }

    pub fn get_anchor_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&AuditDataKey::AnchorCount)
            .unwrap_or(0)
    }

    pub fn get_latest_anchor(env: Env) -> Option<AnchorEntry> {
        let count: u64 = env
            .storage()
            .instance()
            .get(&AuditDataKey::AnchorCount)
            .unwrap_or(0);
        if count == 0 {
            return None;
        }
        env.storage()
            .instance()
            .get(&AuditDataKey::Anchor(count))
    }

    pub fn verify_chain(
        env: Env,
        head_hash: String,
        expected_length: u64,
    ) -> bool {
        let latest = Self::get_latest_anchor(env);
        match latest {
            Some(entry) => entry.chain_head_hash == head_hash && entry.chain_length == expected_length,
            None => false,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{symbol_short, vec, Env, String};

    #[test]
    fn test_initialize_and_anchor() {
        let env = Env::default();
        let contract_id = env.register_contract(None, AuditContract);
        let client = AuditContractClient::new(&env, &contract_id);

        client.initialize();

        let hash = String::from_slice(&env, b"abcdef0123456789");
        let entry = client.anchor(&hash, &42);

        assert_eq!(entry.chain_head_hash, hash);
        assert_eq!(entry.chain_length, 42);
        assert_eq!(entry.anchor_nonce, 1);

        let count = client.get_anchor_count();
        assert_eq!(count, 1);

        let latest = client.get_latest_anchor();
        assert_eq!(latest.unwrap().anchor_nonce, 1);

        let verified = client.verify_chain(&hash, &42);
        assert!(verified);
    }
}
