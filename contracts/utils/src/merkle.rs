#![no_std]

use soroban_sdk::{Bytes, BytesN, Env, IntoVal, Val, Vec};

const MERKLE_TREE_KEY: &str = "merkle_root";
const LEAF_PREFIX: &str = "leaf_";

#[derive(Clone, Debug)]
pub struct MerkleProof {
    pub index: u64,
    pub siblings: Vec<BytesN<32>>,
}

impl MerkleProof {
    pub fn verify(&self, root: &BytesN<32>, leaf: &BytesN<32>) -> bool {
        let mut current = leaf.clone();
        let mut idx = self.index;

        for i in 0..self.siblings.len() {
            let sibling = self.siblings.get(i).unwrap();
            if idx % 2 == 0 {
                current = hash_pair(&current, &sibling);
            } else {
                current = hash_pair(&sibling, &current);
            }
            idx /= 2;
        }

        current == *root
    }
}

fn hash_bytes(env: &Env, bytes: &Bytes) -> BytesN<32> {
    env.crypto().sha256(bytes).into()
}

fn hash_pair(left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut combined = Bytes::new(left.env());
    combined.append(&left.clone().into());
    combined.append(&right.clone().into());
    hash_bytes(left.env(), &combined)
}

pub fn compute_merkle_root(env: &Env, leaves: &Vec<BytesN<32>>) -> BytesN<32> {
    if leaves.len() == 0 {
        return BytesN::from_array(env, &[0u8; 32]);
    }
    if leaves.len() == 1 {
        return leaves.get(0).unwrap();
    }

    let mut current_level: Vec<BytesN<32>> = Vec::new(env);
    for i in (0..leaves.len()).step_by(2) {
        let left = leaves.get(i).unwrap();
        if i + 1 < leaves.len() {
            let right = leaves.get(i + 1).unwrap();
            current_level.push_back(hash_pair(&left, &right));
        } else {
            current_level.push_back(left);
        }
    }

    compute_merkle_root(env, &current_level)
}

pub fn generate_merkle_proof(
    env: &Env,
    leaves: &Vec<BytesN<32>>,
    leaf_index: u64,
) -> MerkleProof {
    let mut siblings: Vec<BytesN<32>> = Vec::new(env);
    let mut current_level: Vec<BytesN<32>> = Vec::new(env);
    for i in 0..leaves.len() {
        current_level.push_back(leaves.get(i).unwrap());
    }

    let mut idx = leaf_index;
    let mut level_len = current_level.len() as u64;

    while level_len > 1 {
        let mut next_level: Vec<BytesN<32>> = Vec::new(env);
        for i in (0..level_len).step_by(2) {
            let left = current_level.get(i).unwrap();
            if i + 1 < level_len {
                let right = current_level.get(i + 1).unwrap();
                if i as u64 == idx {
                    siblings.push_back(right);
                } else if (i + 1) as u64 == idx {
                    siblings.push_back(left);
                }
                next_level.push_back(hash_pair(&left, &right));
            } else {
                next_level.push_back(left);
            }
        }
        current_level = next_level;
        level_len = current_level.len() as u64;
        idx /= 2;
    }

    MerkleProof { index: leaf_index, siblings }
}

pub fn batch_insert(env: &Env, key_prefix: &Bytes, values: &Vec<(Bytes, Bytes)>) {
    let mut leaves: Vec<BytesN<32>> = Vec::new(env);

    for i in 0..values.len() {
        let (key, value) = values.get(i).unwrap();

        let storage_key = make_storage_key(env, key_prefix, &key);
        env.storage().persistent().set(&storage_key, &value);

        let leaf = hash_key_value(env, &key, &value);
        leaves.push_back(leaf);
    }

    let root = compute_merkle_root(env, &leaves);
    let root_key = make_root_key(env, key_prefix);
    env.storage().instance().set(&root_key, &root);
}

pub fn batch_get(
    env: &Env,
    key_prefix: &Bytes,
    keys: &Vec<Bytes>,
) -> (Vec<(Bytes, Option<Bytes>)>, MerkleProof) {
    let mut results: Vec<(Bytes, Option<Bytes>)> = Vec::new(env);
    let mut leaves: Vec<BytesN<32>> = Vec::new(env);
    let mut leaf_index: u64 = 0;
    let mut target_index: u64 = 0;

    for i in 0..keys.len() {
        let key = keys.get(i).unwrap();
        let storage_key = make_storage_key(env, key_prefix, &key);
        let value: Option<Bytes> = env.storage().persistent().get(&storage_key);

        let leaf = hash_key_value(env, &key, &value);
        leaves.push_back(leaf);

        results.push_back((key, value));

        if i == 0 {
            target_index = leaf_index;
        }
        leaf_index += 1;
    }

    let proof = generate_merkle_proof(env, &leaves, target_index);
    (results, proof)
}

pub fn verify_batch(
    env: &Env,
    key_prefix: &Bytes,
    keys: &Vec<Bytes>,
    values: &Vec<Option<Bytes>>,
    proof: &MerkleProof,
) -> bool {
    let mut leaves: Vec<BytesN<32>> = Vec::new(env);
    for i in 0..keys.len() {
        let leaf = hash_key_value(env, &keys.get(i).unwrap(), &values.get(i).unwrap());
        leaves.push_back(leaf);
    }

    let root_key = make_root_key(env, key_prefix);
    let stored_root: BytesN<32> = match env.storage().instance().get(&root_key) {
        Some(root) => root,
        None => return false,
    };

    let computed_root = compute_merkle_root(env, &leaves);
    proof.verify(&stored_root, &computed_root)
}

fn make_storage_key(env: &Env, prefix: &Bytes, key: &Bytes) -> Bytes {
    let mut storage_key = Bytes::new(env);
    storage_key.append(&prefix);
    storage_key.append(&key);
    storage_key
}

fn make_root_key(env: &Env, prefix: &Bytes) -> Bytes {
    let mut root_key = Bytes::new(env);
    root_key.append(&prefix);
    root_key.append(&Bytes::from_slice(env, b"_merkle_root"));
    root_key
}

fn hash_key_value(env: &Env, key: &Bytes, value: &Option<Bytes>) -> BytesN<32> {
    let mut input = Bytes::new(env);
    input.append(key);
    match value {
        Some(v) => input.append(v),
        None => {
            let zero = Bytes::from_slice(env, &[0u8; 1]);
            input.append(&zero);
        }
    }
    hash_bytes(env, &input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle_root_single_leaf() {
        let env = Env::default();
        let leaf = BytesN::from_array(&env, &[1u8; 32]);
        let leaves = Vec::from_array(&env, [leaf.clone()]);
        let root = compute_merkle_root(&env, &leaves);
        assert_eq!(root, leaf);
    }

    #[test]
    fn test_merkle_proof_verification() {
        let env = Env::default();
        let leaf1 = BytesN::from_array(&env, &[1u8; 32]);
        let leaf2 = BytesN::from_array(&env, &[2u8; 32]);
        let leaves = Vec::from_array(&env, [leaf1.clone(), leaf2.clone()]);

        let root = compute_merkle_root(&env, &leaves);
        let proof = generate_merkle_proof(&env, &leaves, 0);

        assert!(proof.verify(&root, &leaf1));
    }

    #[test]
    fn test_batch_insert_and_get() {
        let env = Env::default();
        env.mock_all_auths();

        let prefix = Bytes::from_slice(&env, b"test_");
        let key1 = Bytes::from_slice(&env, b"key1");
        let val1 = Bytes::from_slice(&env, b"value1");
        let key2 = Bytes::from_slice(&env, b"key2");
        let val2 = Bytes::from_slice(&env, b"value2");

        let values = Vec::from_array(&env, [
            (key1.clone(), val1.clone()),
            (key2.clone(), val2.clone()),
        ]);

        batch_insert(&env, &prefix, &values);

        let get_keys = Vec::from_array(&env, [key1.clone(), key2.clone()]);
        let (results, proof) = batch_get(&env, &prefix, &get_keys);

        let first = results.get(0).unwrap();
        assert_eq!(first.0, key1);
        assert_eq!(first.1.unwrap(), val1);

        let verify_keys = get_keys;
        let verify_values = Vec::from_array(&env, [Some(val1), Some(val2)]);
        assert!(verify_batch(&env, &prefix, &verify_keys, &verify_values, &proof));
    }
}
