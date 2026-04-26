// ════════════════════════════════════════════════════════════════
// BATCH TRANSACTION SYSTEM - Execute multiple operations efficiently
// ════════════════════════════════════════════════════════════════

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, IntoVal, String, Symbol, TryFromVal,
    Val, Vec,
};

// ════════════════════════════════════════════════════════════════
// DATA STRUCTURES
// ════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Admin,
    ContractVersion,
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

#[contract]
pub struct SubTrackrBatch;

#[contractimpl]
impl SubTrackrBatch {
    /// Initialize the contract with an admin.
    ///
    /// The admin is required for upgrade operations.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ContractVersion, &1u32);

        env.events()
            .publish(Symbol::new(&env, "admin_initialized"), admin);
    }

    /// Upgrade the contract WASM (admin-only).
    ///
    /// Note: state is preserved because Soroban upgrades keep instance storage.
    /// If you need migrations, upgrade first, then call `migrate`.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        admin.require_auth();

        env.events().publish(
            Symbol::new(&env, "contract_upgrade_requested"),
            new_wasm_hash.clone(),
        );

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        env.events()
            .publish(Symbol::new(&env, "contract_upgraded"), admin);
    }

    /// Post-upgrade migration hook (admin-only).
    pub fn migrate(env: Env, new_version: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &new_version);

        env.events()
            .publish(Symbol::new(&env, "contract_migrated"), new_version);
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
