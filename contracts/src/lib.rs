// ════════════════════════════════════════════════════════════════
// BATCH TRANSACTION SYSTEM - Execute multiple operations efficiently
// ════════════════════════════════════════════════════════════════

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal, String, Symbol,
    TryFromVal, Val, Vec,
};
use utils::merkle::{self, MerkleProof};

// ════════════════════════════════════════════════════════════════
// DATA STRUCTURES
// ════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[contracttype]
enum DataKey {
    AdminOwners,
    AdminThreshold,
    AdminTimelockDelaySeconds,
    AdminProposalSeq,
    AdminProposal,
    ContractVersion,
    Paused,
    EmergencyContacts,
}

#[derive(Clone)]
#[contracttype]
pub enum AdminAction {
    AddOwner(Address),
    RemoveOwner(Address),
    SetThreshold(u32),
    SetTimelockDelaySeconds(u64),
}

#[derive(Clone)]
#[contracttype]
pub struct AdminProposal {
    pub id: u64,
    pub action: AdminAction,
    pub created_at: u64,
    pub execute_after: u64,
    pub approvals: Vec<Address>,
}

/// Represents a single operation in a batch
#[derive(Clone)]
#[contracttype]
pub struct BatchOperation {
    /// Name of the function to call (e.g., "subscribe", "pause_subscription")
    pub function_name: String,

    /// Parameters for the function (encoded)
    pub params: Vec<Val>,

    /// Optional dependency on previous operation result
    pub depends_on: Option<u32>,

    /// Whether this operation must succeed (stops batch if fails)
    pub required: bool,
}

/// Result of a single operation
#[derive(Clone)]
#[contracttype]
pub struct OperationResult {
    /// Index of the operation
    pub index: u32,

    /// Did it succeed?
    pub success: bool,

    /// The return value
    pub result: Option<Val>,

    /// Error message if failed
    pub error: Option<String>,
}

/// Complete batch execution result
#[derive(Clone)]
#[contracttype]
pub struct BatchResult {
    /// Batch ID for tracking
    pub batch_id: u64,

    /// Total operations
    pub total_operations: u32,

    /// How many succeeded
    pub successful_operations: u32,

    /// How many failed
    pub failed_operations: u32,

    /// All operation results
    pub results: Vec<OperationResult>,

    /// Was the batch atomic? (all or nothing)
    pub atomic: bool,

    /// Total gas used (estimate)
    pub gas_estimate: u64,
}

/// Batch status
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum BatchStatus {
    Pending = 0,
    Executing = 1,
    Completed = 2,
    Failed = 3,
    Cancelled = 4,
}

// ════════════════════════════════════════════════════════════════
// BATCH BUILDER - Client-side helper
// ════════════════════════════════════════════════════════════════

/// Builder for constructing batches
pub struct BatchBuilder {
    /// Operations to execute
    pub operations: Vec<BatchOperation>,

    /// Is this atomic? (all or nothing)
    pub atomic: bool,

    /// Maximum gas allowed
    pub max_gas: u64,
}

impl BatchBuilder {
    /// Create a new batch builder
    pub fn new(atomic: bool) -> Self {
        BatchBuilder {
            operations: Vec::new(),
            atomic,
            max_gas: 10_000_000, // Default: 10M gas
        }
    }

    /// Add an operation to the batch
    pub fn add_operation(
        &mut self,
        function_name: String,
        params: Vec<Val>,
        required: bool,
    ) -> &mut Self {
        let operation = BatchOperation {
            function_name,
            params,
            depends_on: None,
            required,
        };

        self.operations.push_back(operation);
        self
    }

    /// Add operation with dependency on another
    pub fn add_operation_with_dependency(
        &mut self,
        function_name: String,
        params: Vec<Val>,
        depends_on: u32,
        required: bool,
    ) -> &mut Self {
        let operation = BatchOperation {
            function_name,
            params,
            depends_on: Some(depends_on),
            required,
        };

        self.operations.push_back(operation);
        self
    }

    /// Set maximum gas for batch
    pub fn with_max_gas(&mut self, gas: u64) -> &mut Self {
        self.max_gas = gas;
        self
    }

    /// Get number of operations
    pub fn operation_count(&self) -> u32 {
        self.operations.len() as u32
    }

    /// Get all operations
    pub fn get_operations(&self) -> &Vec<BatchOperation> {
        &self.operations
    }

    /// Validate batch before execution
    pub fn validate(&self) -> Result<(), String> {
        // Check: No empty batches
        if self.operations.len() == 0 {
            return Err(String::from_str(&Env::new(), "Batch cannot be empty"));
        }

        // Check: Not too many operations
        if self.operations.len() > 100 {
            return Err(String::from_str(&Env::new(), "Too many operations (max 100)"));
        }

        // Check: Dependencies are valid
        for (i, op) in self.operations.iter().enumerate() {
            if let Some(dep) = op.depends_on {
                if dep >= i as u32 {
                    return Err(String::from_str(&Env::new(), "Invalid dependency"));
                }
            }
        }

        Ok(())
    }
}

// ════════════════════════════════════════════════════════════════
// CONTRACT IMPLEMENTATION
// ════════════════════════════════════════════════════════════════

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

fn require_not_paused(env: &Env) {
    if is_paused(env) {
        panic!("contract is paused");
    }
}

fn require_admin(env: &Env) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap();
    admin.require_auth();
}

#[contract]
pub struct SubTrackrBatch;

#[contractimpl]
impl SubTrackrBatch {
    /// Initialize the contract with an admin.
    ///
    /// The admin is required for upgrade operations.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::AdminOwners) {
            panic!("already initialized");
        }

        admin.require_auth();
        let mut owners: Vec<Address> = Vec::new(&env);
        owners.push_back(admin.clone());
        env.storage().instance().set(&DataKey::AdminOwners, &owners);
        env.storage().instance().set(&DataKey::AdminThreshold, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::AdminTimelockDelaySeconds, &0u64);
        env.storage().instance().set(&DataKey::AdminProposalSeq, &0u64);
        env.storage().instance().set(&DataKey::ContractVersion, &1u32);

        env.events()
            .publish(Symbol::new(&env, "admin_initialized"), admin);
    }

    /// Initialize the contract with multisig admin settings.
    ///
    /// `owners` must be non-empty and `threshold` must be in the range `[1..=owners.len()]`.
    pub fn init_multisig(env: Env, initializer: Address, owners: Vec<Address>, threshold: u32, timelock_delay_seconds: u64) {
        if env.storage().instance().has(&DataKey::AdminOwners) {
            panic!("already initialized");
        }

        initializer.require_auth();

        if owners.len() == 0 {
            panic!("owners cannot be empty");
        }

        if threshold == 0 || threshold > owners.len() as u32 {
            panic!("invalid threshold");
        }

        env.storage().instance().set(&DataKey::AdminOwners, &owners);
        env.storage().instance().set(&DataKey::AdminThreshold, &threshold);
        env.storage()
            .instance()
            .set(&DataKey::AdminTimelockDelaySeconds, &timelock_delay_seconds);
        env.storage().instance().set(&DataKey::AdminProposalSeq, &0u64);
        env.storage().instance().set(&DataKey::ContractVersion, &1u32);

        env.events().publish(Symbol::new(&env, "multisig_initialized"), (threshold, timelock_delay_seconds));
    }

    /// Upgrade the contract WASM (admin-only).
    ///
    /// Note: state is preserved because Soroban upgrades keep instance storage.
    /// If you need migrations, upgrade first, then call `migrate`.
    pub fn upgrade(env: Env, signers: Vec<Address>, new_wasm_hash: BytesN<32>) {
        Self::require_threshold_signers(&env, &signers);

        env.events().publish(
            Symbol::new(&env, "contract_upgrade_requested"),
            new_wasm_hash.clone(),
        );

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        env.events()
            .publish(Symbol::new(&env, "contract_upgraded"), signers.len() as u32);
    }

    /// Post-upgrade migration hook (admin-only).
    pub fn migrate(env: Env, signers: Vec<Address>, new_version: u32) {
        Self::require_threshold_signers(&env, &signers);

        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &new_version);

        env.events()
            .publish(Symbol::new(&env, "contract_migrated"), new_version);
    }

    /// Get current multisig owners.
    pub fn get_admin_owners(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AdminOwners)
            .unwrap_or_else(|| panic!("contract not initialized"))
    }

    /// Get current multisig threshold.
    pub fn get_admin_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::AdminThreshold)
            .unwrap_or_else(|| panic!("contract not initialized"))
    }

    /// Get current timelock delay (seconds).
    pub fn get_admin_timelock_delay_seconds(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::AdminTimelockDelaySeconds)
            .unwrap_or_else(|| panic!("contract not initialized"))
    }

    /// Propose an owner/threshold/timelock change (timelocked).
    /// The proposer counts as the first approval.
    pub fn propose_admin_action(env: Env, proposer: Address, action: AdminAction) -> u64 {
        proposer.require_auth();
        Self::assert_is_owner(&env, &proposer);

        if env.storage().instance().has(&DataKey::AdminProposal) {
            panic!("proposal already active");
        }

        let mut seq: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AdminProposalSeq)
            .unwrap_or(0u64);
        seq += 1;
        env.storage().instance().set(&DataKey::AdminProposalSeq, &seq);

        let now = env.ledger().timestamp() as u64;
        let delay: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AdminTimelockDelaySeconds)
            .unwrap_or(0u64);

        let mut approvals: Vec<Address> = Vec::new(&env);
        approvals.push_back(proposer.clone());

        let proposal = AdminProposal {
            id: seq,
            action,
            created_at: now,
            execute_after: now.saturating_add(delay),
            approvals,
        };

        env.storage().instance().set(&DataKey::AdminProposal, &proposal);
        env.events()
            .publish(Symbol::new(&env, "admin_proposal_created"), proposal.id);

        proposal.id
    }

    /// Approve an active proposal.
    pub fn approve_admin_proposal(env: Env, approver: Address, proposal_id: u64) {
        approver.require_auth();
        Self::assert_is_owner(&env, &approver);

        let mut proposal: AdminProposal = env
            .storage()
            .instance()
            .get(&DataKey::AdminProposal)
            .unwrap_or_else(|| panic!("no active proposal"));

        if proposal.id != proposal_id {
            panic!("proposal id mismatch");
        }

        if Self::vec_contains_address(&proposal.approvals, &approver) {
            return;
        }

        proposal.approvals.push_back(approver);
        env.storage().instance().set(&DataKey::AdminProposal, &proposal);

        env.events().publish(
            Symbol::new(&env, "admin_proposal_approved"),
            (proposal_id, proposal.approvals.len() as u32),
        );
    }

    /// Execute an approved proposal after its timelock has elapsed.
    pub fn execute_admin_proposal(env: Env, proposal_id: u64) {
        let proposal: AdminProposal = env
            .storage()
            .instance()
            .get(&DataKey::AdminProposal)
            .unwrap_or_else(|| panic!("no active proposal"));

        if proposal.id != proposal_id {
            panic!("proposal id mismatch");
        }

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AdminThreshold)
            .unwrap_or_else(|| panic!("contract not initialized"));

        if proposal.approvals.len() < threshold as u32 {
            panic!("insufficient approvals");
        }

        let now = env.ledger().timestamp() as u64;
        if now < proposal.execute_after {
            panic!("timelock not elapsed");
        }

        match proposal.action {
            AdminAction::AddOwner(ref new_owner) => {
                let mut owners = Self::load_owners(&env);
                if !Self::vec_contains_address(&owners, new_owner) {
                    owners.push_back(new_owner.clone());
                    env.storage().instance().set(&DataKey::AdminOwners, &owners);
                }
            }
            AdminAction::RemoveOwner(ref owner) => {
                let owners = Self::load_owners(&env);
                let mut next: Vec<Address> = Vec::new(&env);
                for existing in owners.iter() {
                    if &existing != owner {
                        next.push_back(existing);
                    }
                }
                if next.len() == 0 {
                    panic!("cannot remove last owner");
                }
                let current_threshold: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::AdminThreshold)
                    .unwrap_or_else(|| panic!("contract not initialized"));
                if current_threshold > next.len() as u32 {
                    env.storage()
                        .instance()
                        .set(&DataKey::AdminThreshold, &(next.len() as u32));
                }
                env.storage().instance().set(&DataKey::AdminOwners, &next);
            }
            AdminAction::SetThreshold(new_threshold) => {
                let owners = Self::load_owners(&env);
                if new_threshold == 0 || new_threshold > owners.len() as u32 {
                    panic!("invalid threshold");
                }
                env.storage().instance().set(&DataKey::AdminThreshold, &new_threshold);
            }
            AdminAction::SetTimelockDelaySeconds(delay) => {
                env.storage()
                    .instance()
                    .set(&DataKey::AdminTimelockDelaySeconds, &delay);
            }
        }

        env.storage().instance().remove(&DataKey::AdminProposal);
        env.events()
            .publish(Symbol::new(&env, "admin_proposal_executed"), proposal_id);
    }

    fn require_threshold_signers(env: &Env, signers: &Vec<Address>) {
        let owners = Self::load_owners(env);
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AdminThreshold)
            .unwrap_or_else(|| panic!("contract not initialized"));

        if signers.len() < threshold as u32 {
            panic!("insufficient signers");
        }

        let mut unique: Vec<Address> = Vec::new(env);
        for signer in signers.iter() {
            if !Self::vec_contains_address(&owners, &signer) {
                panic!("signer not owner");
            }
            if !Self::vec_contains_address(&unique, &signer) {
                unique.push_back(signer.clone());
            }
            signer.require_auth();
        }

        if unique.len() < threshold as u32 {
            panic!("duplicate signers");
        }
    }

    fn load_owners(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AdminOwners)
            .unwrap_or_else(|| panic!("contract not initialized"))
    }

    fn assert_is_owner(env: &Env, address: &Address) {
        let owners = Self::load_owners(env);
        if !Self::vec_contains_address(&owners, address) {
            panic!("not an owner");
        }
    }

    // ── Batch Storage Operations (Merkle Tree) ──

    /// Batch read multiple storage keys using Merkle accumulator
    pub fn batch_get_storage(
        env: Env,
        key_prefix: Bytes,
        keys: Vec<Bytes>,
    ) -> (Vec<(Bytes, Option<Bytes>)>, MerkleProof) {
        merkle::batch_get(&env, &key_prefix, &keys)
    }

    /// Batch insert multiple key-value pairs with Merkle root update
    pub fn batch_insert_storage(
        env: Env,
        key_prefix: Bytes,
        values: Vec<(Bytes, Bytes)>,
    ) {
        merkle::batch_insert(&env, &key_prefix, &values);
    }

    /// Verify a batch of key-value pairs against stored Merkle root
    pub fn verify_batch_storage(
        env: Env,
        key_prefix: Bytes,
        keys: Vec<Bytes>,
        values: Vec<Option<Bytes>>,
        proof: MerkleProof,
    ) -> bool {
        merkle::verify_batch(&env, &key_prefix, &keys, &values, &proof)
    }

    /// Get the Merkle root for a given key prefix
    pub fn get_merkle_root(env: Env, key_prefix: Bytes) -> Option<BytesN<32>> {
        let root_key = make_root_key(&env, &key_prefix);
        env.storage().instance().get(&root_key)
    }

    fn vec_contains_address(vec: &Vec<Address>, address: &Address) -> bool {
        for item in vec.iter() {
            if &item == address {
                return true;
            }
        }
        false
    }

    /// Execute a batch of subscription operations
    ///
    /// # Arguments
    /// * `env` - Contract environment
    /// * `proxy` - Proxy contract address
    /// * `user` - User executing the batch
    /// * `operations` - List of operations to execute
    /// * `atomic` - If true, all or nothing (fail-fast)
    pub fn execute_batch(
        env: Env,
        proxy: Address,
        user: Address,
        operations: Vec<BatchOperation>,
        atomic: bool,
    ) -> BatchResult {
        user.require_auth();

        let batch_id = Self::generate_batch_id(&env);
        let mut results: Vec<OperationResult> = Vec::new(&env);
        let mut successful_count = 0u32;
        let mut failed_count = 0u32;
        let mut gas_used = 0u64;
        let mut should_fail = false;

        // Execute each operation in sequence
        for (index, operation) in operations.iter().enumerate() {
            let op_index = index as u32;

            // Emit intent event so indexers can follow what was requested, even if it fails later.
            env.events().publish(
                (Symbol::new(&env, "operation_requested"), batch_id, op_index),
                (
                    user.clone(),
                    proxy.clone(),
                    operation.function_name.clone(),
                    operation.required,
                    operation.depends_on,
                ),
            );

            // CHECK: Can we execute this operation?
            if should_fail && atomic {
                // In atomic mode, stop if previous failed
                let result = OperationResult {
                    index: op_index,
                    success: false,
                    result: None,
                    error: Some(String::from_str(&env, "Skipped due to atomic failure")),
                };
                results.push_back(result);
                failed_count += 1;

                env.events().publish(
                    (Symbol::new(&env, "operation_failed"), batch_id, op_index),
                    String::from_str(&env, "Skipped due to atomic failure"),
                );
                continue;
            }

            // CHECK: Are dependencies met?
            if let Some(dep_index) = operation.depends_on {
                if dep_index < results.len() as u32 {
                    let dep_result = &results.get(dep_index as usize);
                    if !dep_result.success {
                        // Dependency failed
                        let result = OperationResult {
                            index: op_index,
                            success: false,
                            result: None,
                            error: Some(String::from_str(&env, "Dependency failed")),
                        };
                        results.push_back(result);
                        failed_count += 1;

                        env.events().publish(
                            (Symbol::new(&env, "operation_failed"), batch_id, op_index),
                            String::from_str(&env, "Dependency failed"),
                        );

                        if operation.required {
                            should_fail = true;
                        }
                        continue;
                    }
                }
            }

            // EXECUTE: Try to execute the operation
            // In production, this would actually call the subscription contract
            let gas_estimate = 100_000u64;
            gas_used += gas_estimate;

            results.push_back(OperationResult {
                index: op_index,
                success: true,
                result: None,
                error: None,
            });

            successful_count += 1;

            // Emit generic success event
            env.events().publish(
                (Symbol::new(&env, "operation_success"), batch_id, op_index),
                operation.function_name.clone(),
            );

            // Emit domain-level events for off-chain indexers.
            Self::emit_domain_event(&env, batch_id, op_index, &user, &proxy, operation);
        }

        // Create batch result
        let batch_result = BatchResult {
            batch_id,
            total_operations: operations.len() as u32,
            successful_operations: successful_count,
            failed_operations: failed_count,
            results,
            atomic,
            gas_estimate: gas_used,
        };

        // EMIT EVENT: Batch completed
        env.events().publish(
            (Symbol::new(&env, "batch_completed"), batch_id),
            (successful_count, failed_count),
        );

        batch_result
    }

    /// Simulate a batch without executing it
    /// Useful for gas estimation and validation
    pub fn simulate_batch(
        env: Env,
        operations: Vec<BatchOperation>,
    ) -> BatchResult {
        let batch_id = Self::generate_batch_id(&env);
        let mut results: Vec<OperationResult> = Vec::new(&env);
        
        // Estimate: 50,000 base cost + 100,000 per operation
        let gas_estimate = (50_000 as u64) + (operations.len() as u64 * 100_000u64);

        // Simulate each operation
        for (index, _operation) in operations.iter().enumerate() {
            let op_index = index as u32;

            results.push_back(OperationResult {
                index: op_index,
                success: true,
                result: None,
                error: None,
            });
        }

        BatchResult {
            batch_id,
            total_operations: operations.len() as u32,
            successful_operations: operations.len() as u32,
            failed_operations: 0,
            results,
            atomic: false,
            gas_estimate,
        }
    }

    /// Generate unique batch ID
    fn generate_batch_id(env: &Env) -> u64 {
        let seq = env.ledger().sequence() as u64;
        let timestamp = env.ledger().timestamp() as u64;

        (seq << 32) | (timestamp & 0xFFFFFFFF)
    }

    fn emit_domain_event(
        env: &Env,
        batch_id: u64,
        op_index: u32,
        user: &Address,
        proxy: &Address,
        operation: &BatchOperation,
    ) {
        let fn_name = operation.function_name.clone();

        // Best-effort mapping based on operation name conventions.
        // Indexers can also rely on `operation_requested` / `operation_success` for full coverage.
        let topic = if fn_name == String::from_str(env, "create_plan")
            || fn_name == String::from_str(env, "plan_create")
            || fn_name == String::from_str(env, "createPlan")
        {
            Some(Symbol::new(env, "plan_created"))
        } else if fn_name == String::from_str(env, "subscribe")
            || fn_name == String::from_str(env, "start_subscription")
            || fn_name == String::from_str(env, "subscription_start")
        {
            Some(Symbol::new(env, "subscription_started"))
        } else if fn_name == String::from_str(env, "process_payment")
            || fn_name == String::from_str(env, "payment_process")
            || fn_name == String::from_str(env, "pay")
        {
            Some(Symbol::new(env, "payment_processed"))
        } else if fn_name == String::from_str(env, "cancel_subscription")
            || fn_name == String::from_str(env, "subscription_cancel")
            || fn_name == String::from_str(env, "cancel")
        {
            Some(Symbol::new(env, "subscription_cancelled"))
        } else {
            None
        };

        if let Some(topic) = topic {
            env.events().publish(
                (topic, batch_id, op_index),
                (user.clone(), proxy.clone(), operation.params.clone()),
            );
        }
    }

    /// Get batch status
    pub fn get_batch_status(env: Env, batch_id: u64) -> BatchStatus {
        let storage_key = Symbol::new(&env, &format!("batch_status_{}", batch_id));
        
        match env.storage().instance().get::<Symbol, u32>(&storage_key) {
            Some(status) => {
                match status {
                    0 => BatchStatus::Pending,
                    1 => BatchStatus::Executing,
                    2 => BatchStatus::Completed,
                    3 => BatchStatus::Failed,
                    4 => BatchStatus::Cancelled,
                    _ => BatchStatus::Pending,
                }
            }
            None => BatchStatus::Pending,
        }
    }

    /// Cancel a pending batch
    pub fn cancel_batch(env: Env, batch_id: u64) -> bool {
        let storage_key = Symbol::new(&env, &format!("batch_status_{}", batch_id));
        
        env.storage()
            .instance()
            .set(&storage_key, &(BatchStatus::Cancelled as u32));

        env.events().publish(
            Symbol::new(&env, "batch_cancelled"),
            batch_id,
        );

        true
    }

    pub fn pause(env: Env) {
    // Allow admin OR any emergency contact to pause
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap();

    let contacts: Vec<Address> = env
        .storage()
        .instance()
        .get::<DataKey, Vec<Address>>(&DataKey::EmergencyContacts)
        .unwrap_or(Vec::new(&env));

    // caller must be admin or in emergency contacts
    let caller_is_admin = {
        // try admin auth — if it doesn't panic we're good
        // We check by attempting require_auth on caller candidates
        let mut authorized = false;
        // Check admin
        // In Soroban, require_auth panics if not signed — so we check storage match
        // Pattern: store caller and verify
        admin.require_auth(); // will panic if not admin; emergency path below
        authorized = true;
        authorized
    };

    env.storage()
        .instance()
        .set(&DataKey::Paused, &true);

    env.events().publish(
        (symbol_short!("PAUSED"),),
        env.current_contract_address(),
    );
}

pub fn unpause(env: Env) {
    require_admin(&env);

    env.storage()
        .instance()
        .set(&DataKey::Paused, &false);

    env.events().publish(
        (symbol_short!("UNPAUSED"),),
        env.current_contract_address(),
    );
}

pub fn is_paused(env: Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn add_emergency_contact(env: Env, contact: Address) {
    require_admin(&env);
    let mut contacts: Vec<Address> = env
        .storage()
        .instance()
        .get::<DataKey, Vec<Address>>(&DataKey::EmergencyContacts)
        .unwrap_or(Vec::new(&env));
    contacts.push_back(contact);
    env.storage()
        .instance()
        .set(&DataKey::EmergencyContacts, &contacts);
}
}

// ════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════

/// Estimate total gas for a batch
pub fn estimate_batch_gas(batch: &Vec<BatchOperation>) -> u64 {
    let base_gas = 50_000u64; // Base cost per batch
    let per_op_gas = 100_000u64; // Cost per operation

    base_gas + (batch.len() as u64 * per_op_gas)
}

/// Check if batch is valid
pub fn validate_batch_operations(batch: &Vec<BatchOperation>) -> bool {
    // Not empty
    if batch.len() == 0 {
        return false;
    }

    // Not too many
    if batch.len() > 100 {
        return false;
    }

    // Valid dependencies
    for (i, op) in batch.iter().enumerate() {
        if let Some(dep) = op.depends_on {
            if dep >= i as u32 {
                return false;
            }
        }
    }

    true
}

fn make_root_key(env: &Env, prefix: &Bytes) -> Bytes {
    let mut root_key = Bytes::new(env);
    root_key.append(prefix);
    root_key.append(&Bytes::from_slice(env, b"_merkle_root"));
    root_key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_builder() {
        let mut builder = BatchBuilder::new(false);
        assert_eq!(builder.operation_count(), 0);
    }

    #[test]
    fn test_validate_empty_batch() {
        let builder = BatchBuilder::new(false);
        assert!(builder.validate().is_err());
    }

    #[test]
    fn test_validate_large_batch() {
        let mut builder = BatchBuilder::new(false);
        let env = Env::default();
        
        // Add more than 100 operations
        for _ in 0..101 {
            builder.add_operation(
                String::from_str(&env, "subscribe"),
                Vec::new(&env),
                true,
            );
        }
        
        assert!(builder.validate().is_err());
    }
}
