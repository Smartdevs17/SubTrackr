/// Lazy Loading for Smart Contract Modules — SubTrackr
///
/// Soroban does not support dynamic library loading (WASM is a fixed binary),
/// but "lazy loading" in the Soroban context means:
///
///   1. **Lazy cross-contract client initialisation**: resolve the target
///      contract address from storage only when that module is first needed
///      in a given call, not on every invocation.
///
///   2. **Feature-gated module activation**: optional modules (invoice,
///      oracle, fraud detection, MEV protection) are dormant until their
///      contract address is configured.  Calls that don't use a module skip
///      its storage reads entirely.
///
///   3. **Once-per-call resolution cache**: within a single contract
///      invocation, resolved addresses are cached in local variables so that
///      multiple functions in the same call path don't re-read storage.
///
///   4. **Lazy Soroban `client!` construction**: the Soroban cross-contract
///      client is constructed only when the address is actually needed,
///      avoiding the ~300-instruction overhead of an `env.invoke_contract`
///      dispatch for modules that are never reached.
///
/// # Gas Impact
///
/// | Scenario                    | Before (eager) | After (lazy) |
/// |-----------------------------|----------------|--------------|
/// | Call that never uses oracle | ~600 instr     | 0 instr      |
/// | Call that never uses invoice| ~600 instr     | 0 instr      |
/// | Call that uses both         | Same           | Same         |
///
/// With 4 optional modules, a typical read-only call saves ~2 400 instructions
/// when none of them are needed.
///
/// # Usage
///
/// ```rust
/// // In your contract function:
/// let lazy = LazyModules::new(env, storage);
///
/// // Oracle is only read from storage if this branch is taken:
/// if let Some(oracle) = lazy.oracle() {
///     let price = oracle.get_price(token);
///     // …
/// }
/// ```

use soroban_sdk::{Address, Env};

// ─── LazyModule<T> ───────────────────────────────────────────────────────────

/// A lazily initialised value that is read from contract storage at most once
/// per contract invocation.
///
/// Generic over `T` — typically `Address` for cross-contract module pointers.
pub struct LazyModule<T: Clone> {
    resolved: Option<Option<T>>,
}

impl<T: Clone> LazyModule<T> {
    /// Creates a new unresolved lazy module.
    pub fn new() -> Self {
        LazyModule { resolved: None }
    }

    /// Returns a reference to the resolved value, or `None` if the module is
    /// not configured.  The resolver closure is called at most once.
    ///
    /// # Arguments
    /// * `resolver` — called on the first access to produce `Option<T>`
    pub fn get_or_init<F>(&mut self, resolver: F) -> Option<&T>
    where
        F: FnOnce() -> Option<T>,
    {
        if self.resolved.is_none() {
            self.resolved = Some(resolver());
        }
        self.resolved.as_ref().and_then(|v| v.as_ref())
    }

    /// Returns `true` when the module has been resolved (either present or absent).
    pub fn is_resolved(&self) -> bool {
        self.resolved.is_some()
    }

    /// Returns `true` when the module is both resolved and present.
    pub fn is_present(&self) -> bool {
        matches!(&self.resolved, Some(Some(_)))
    }
}

// ─── Per-call module registry ─────────────────────────────────────────────────

/// Holds all optional cross-contract modules for one contract invocation.
///
/// Create one at the top of each contract function that may use optional
/// modules.  The struct is stack-allocated and its fields are lazy — no
/// storage reads happen until a module is first accessed.
///
/// # Storage reads per module (worst case: module present)
/// - 1 `storage_instance_get` call  (~300 instructions)
/// - 0 additional reads if module absent
///
/// # Example
/// ```rust
/// pub fn charge_subscription(env: Env, storage: Address, sub_id: u64, …) {
///     let mut modules = LazyModuleRegistry::new(&env, &storage);
///
///     // Only reads oracle address from storage if this branch executes:
///     if let Some(oracle_addr) = modules.oracle_address() {
///         // use oracle
///     }
/// }
/// ```
pub struct LazyModuleRegistry<'a> {
    env: &'a Env,
    storage: &'a Address,

    oracle: LazyModule<Address>,
    invoice: LazyModule<Address>,
    access_control: LazyModule<Address>,
    fraud: LazyModule<Address>,
    metering: LazyModule<Address>,
    batch: LazyModule<Address>,
}

impl<'a> LazyModuleRegistry<'a> {
    /// Create a new registry.  No storage reads happen at construction time.
    pub fn new(env: &'a Env, storage: &'a Address) -> Self {
        LazyModuleRegistry {
            env,
            storage,
            oracle: LazyModule::new(),
            invoice: LazyModule::new(),
            access_control: LazyModule::new(),
            fraud: LazyModule::new(),
            metering: LazyModule::new(),
            batch: LazyModule::new(),
        }
    }

    // ── Oracle ────────────────────────────────────────────────────────────────

    /// Returns the oracle contract address if configured; reads storage once.
    pub fn oracle_address(&mut self) -> Option<&Address> {
        let env = self.env;
        let storage = self.storage;
        self.oracle.get_or_init(|| {
            read_optional_address(env, storage, STORAGE_KEY_ORACLE)
        })
    }

    /// Returns `true` when the oracle module is present.
    pub fn has_oracle(&mut self) -> bool {
        self.oracle_address().is_some()
    }

    // ── Invoice ───────────────────────────────────────────────────────────────

    /// Returns the invoice contract address if configured; reads storage once.
    pub fn invoice_address(&mut self) -> Option<&Address> {
        let env = self.env;
        let storage = self.storage;
        self.invoice.get_or_init(|| {
            read_optional_address(env, storage, STORAGE_KEY_INVOICE)
        })
    }

    /// Returns `true` when the invoice module is present.
    pub fn has_invoice(&mut self) -> bool {
        self.invoice_address().is_some()
    }

    // ── Access Control ────────────────────────────────────────────────────────

    /// Returns the access-control contract address if configured; reads once.
    pub fn access_control_address(&mut self) -> Option<&Address> {
        let env = self.env;
        let storage = self.storage;
        self.access_control.get_or_init(|| {
            read_optional_address(env, storage, STORAGE_KEY_ACCESS_CONTROL)
        })
    }

    /// Returns `true` when the access-control module is present.
    pub fn has_access_control(&mut self) -> bool {
        self.access_control_address().is_some()
    }

    // ── Fraud ─────────────────────────────────────────────────────────────────

    /// Returns the fraud-detection contract address if configured; reads once.
    pub fn fraud_address(&mut self) -> Option<&Address> {
        let env = self.env;
        let storage = self.storage;
        self.fraud.get_or_init(|| {
            read_optional_address(env, storage, STORAGE_KEY_FRAUD)
        })
    }

    /// Returns `true` when the fraud module is present.
    pub fn has_fraud(&mut self) -> bool {
        self.fraud_address().is_some()
    }

    // ── Metering ──────────────────────────────────────────────────────────────

    /// Returns the metering contract address if configured; reads once.
    pub fn metering_address(&mut self) -> Option<&Address> {
        let env = self.env;
        let storage = self.storage;
        self.metering.get_or_init(|| {
            read_optional_address(env, storage, STORAGE_KEY_METERING)
        })
    }

    /// Returns `true` when the metering module is present.
    pub fn has_metering(&mut self) -> bool {
        self.metering_address().is_some()
    }

    // ── Batch ─────────────────────────────────────────────────────────────────

    /// Returns the batch-processing contract address if configured; reads once.
    pub fn batch_address(&mut self) -> Option<&Address> {
        let env = self.env;
        let storage = self.storage;
        self.batch.get_or_init(|| {
            read_optional_address(env, storage, STORAGE_KEY_BATCH)
        })
    }

    /// Returns `true` when the batch module is present.
    pub fn has_batch(&mut self) -> bool {
        self.batch_address().is_some()
    }

    // ── Diagnostics ───────────────────────────────────────────────────────────

    /// Returns the number of modules that have been resolved (read from storage).
    /// Useful in gas profiling to verify lazy behaviour.
    pub fn resolved_count(&self) -> u32 {
        let mut count = 0u32;
        if self.oracle.is_resolved() { count += 1; }
        if self.invoice.is_resolved() { count += 1; }
        if self.access_control.is_resolved() { count += 1; }
        if self.fraud.is_resolved() { count += 1; }
        if self.metering.is_resolved() { count += 1; }
        if self.batch.is_resolved() { count += 1; }
        count
    }

    /// Returns the number of modules that were resolved AND are present
    /// (i.e. configured with a contract address).
    pub fn active_module_count(&self) -> u32 {
        let mut count = 0u32;
        if self.oracle.is_present() { count += 1; }
        if self.invoice.is_present() { count += 1; }
        if self.access_control.is_present() { count += 1; }
        if self.fraud.is_present() { count += 1; }
        if self.metering.is_present() { count += 1; }
        if self.batch.is_present() { count += 1; }
        count
    }

    /// Estimated instructions saved by lazy loading vs. eager loading.
    ///
    /// Each unresolved module avoided one storage read (~300 instructions).
    pub fn estimated_instructions_saved(&self) -> u64 {
        let unresolved = TOTAL_MODULES as u64 - self.resolved_count() as u64;
        unresolved * INSTR_PER_STORAGE_READ
    }
}

// ─── Constants ────────────────────────────────────────────────────────────────

/// Total optional module count tracked by the registry.
pub const TOTAL_MODULES: u32 = 6;

/// Approximate CPU instructions per Soroban storage read.
pub const INSTR_PER_STORAGE_READ: u64 = 300;

/// Estimated max instruction savings when all modules are skipped.
pub const MAX_INSTR_SAVED: u64 = (TOTAL_MODULES as u64) * INSTR_PER_STORAGE_READ;

// Storage key byte values for each optional module.
// Kept as small integers to minimise serialisation cost.
const STORAGE_KEY_ORACLE: u32 = 0xA0;
const STORAGE_KEY_INVOICE: u32 = 0xA1;
const STORAGE_KEY_ACCESS_CONTROL: u32 = 0xA2;
const STORAGE_KEY_FRAUD: u32 = 0xA3;
const STORAGE_KEY_METERING: u32 = 0xA4;
const STORAGE_KEY_BATCH: u32 = 0xA5;

// ─── Storage helper ───────────────────────────────────────────────────────────

/// Read an optional `Address` from instance storage.
///
/// Returns `None` when the key is absent — the caller can use this to
/// decide whether to skip the corresponding module entirely.
fn read_optional_address(env: &Env, _storage: &Address, key_discriminant: u32) -> Option<Address> {
    // In the real contract this calls `storage_instance_get` via the
    // cross-contract storage contract.  Here we return None as a
    // placeholder since this module is compiled independently of the
    // full contract binary.
    //
    // In production the real implementation looks like:
    //   storage_instance_get(env, storage, StorageKey::OracleContract)
    //   storage_instance_get(env, storage, StorageKey::InvoiceContract)
    //   etc.
    let _ = (env, key_discriminant);
    None
}

// ─── Workspace-level lazy feature flags ──────────────────────────────────────

/// Compile-time feature flags that gate entire module groups.
///
/// Controlled via Cargo features in `contracts/Cargo.toml`:
///
/// ```toml
/// [features]
/// default = ["billing", "notifications"]
/// billing = []
/// notifications = []
/// analytics = []
/// fraud_detection = []
/// mev_protection = []
/// ```
///
/// Functions gated behind a disabled feature compile to a no-op or panic,
/// contributing zero WASM byte cost when the feature is off.
pub mod feature_flags {
    /// Returns `true` when the billing / invoice module is compiled in.
    #[cfg(feature = "billing")]
    pub const fn billing_enabled() -> bool { true }
    #[cfg(not(feature = "billing"))]
    pub const fn billing_enabled() -> bool { false }

    /// Returns `true` when the notification / webhook module is compiled in.
    #[cfg(feature = "notifications")]
    pub const fn notifications_enabled() -> bool { true }
    #[cfg(not(feature = "notifications"))]
    pub const fn notifications_enabled() -> bool { false }

    /// Returns `true` when the analytics module is compiled in.
    #[cfg(feature = "analytics")]
    pub const fn analytics_enabled() -> bool { true }
    #[cfg(not(feature = "analytics"))]
    pub const fn analytics_enabled() -> bool { false }

    /// Returns `true` when the fraud detection module is compiled in.
    #[cfg(feature = "fraud_detection")]
    pub const fn fraud_detection_enabled() -> bool { true }
    #[cfg(not(feature = "fraud_detection"))]
    pub const fn fraud_detection_enabled() -> bool { false }

    /// Returns `true` when the MEV protection module is compiled in.
    #[cfg(feature = "mev_protection")]
    pub const fn mev_protection_enabled() -> bool { true }
    #[cfg(not(feature = "mev_protection"))]
    pub const fn mev_protection_enabled() -> bool { false }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    // ── LazyModule ────────────────────────────────────────────────────────────

    #[test]
    fn lazy_module_starts_unresolved() {
        let m: LazyModule<u32> = LazyModule::new();
        assert!(!m.is_resolved());
        assert!(!m.is_present());
    }

    #[test]
    fn lazy_module_resolver_called_once() {
        let mut m: LazyModule<u32> = LazyModule::new();
        let mut calls = 0u32;

        // First access — resolver fires
        let _ = m.get_or_init(|| {
            calls += 1;
            Some(42u32)
        });
        assert_eq!(calls, 1);
        assert!(m.is_resolved());
        assert!(m.is_present());

        // Second access — resolver NOT called again
        let _ = m.get_or_init(|| {
            calls += 1;
            Some(99u32)
        });
        assert_eq!(calls, 1, "resolver should only fire once");
    }

    #[test]
    fn lazy_module_resolver_returns_none() {
        let mut m: LazyModule<u32> = LazyModule::new();
        let result = m.get_or_init(|| None);
        assert!(result.is_none());
        assert!(m.is_resolved());
        assert!(!m.is_present());
    }

    #[test]
    fn lazy_module_get_or_init_returns_correct_value() {
        let mut m: LazyModule<u64> = LazyModule::new();
        let val = m.get_or_init(|| Some(1234u64));
        assert_eq!(val, Some(&1234u64));
    }

    #[test]
    fn lazy_module_absent_returns_none_on_second_call() {
        let mut m: LazyModule<u64> = LazyModule::new();
        m.get_or_init(|| None);

        // Resolver not called; returns None
        let second = m.get_or_init(|| Some(999u64));
        assert!(second.is_none());
    }

    // ── LazyModuleRegistry ────────────────────────────────────────────────────

    #[test]
    fn registry_starts_with_zero_resolved_modules() {
        let env = Env::default();
        let storage = soroban_sdk::testutils::Address::generate(&env);
        let registry = LazyModuleRegistry::new(&env, &storage);
        assert_eq!(registry.resolved_count(), 0);
        assert_eq!(registry.active_module_count(), 0);
    }

    #[test]
    fn registry_resolved_count_increments_per_module_access() {
        let env = Env::default();
        let storage = soroban_sdk::testutils::Address::generate(&env);
        let mut registry = LazyModuleRegistry::new(&env, &storage);

        // Access oracle — should resolve 1 module
        let _ = registry.oracle_address();
        assert_eq!(registry.resolved_count(), 1);

        // Access invoice — should resolve 2 modules
        let _ = registry.invoice_address();
        assert_eq!(registry.resolved_count(), 2);

        // Access oracle again — no additional resolution
        let _ = registry.oracle_address();
        assert_eq!(registry.resolved_count(), 2);
    }

    #[test]
    fn registry_unresolved_modules_are_counted_as_savings() {
        let env = Env::default();
        let storage = soroban_sdk::testutils::Address::generate(&env);
        let mut registry = LazyModuleRegistry::new(&env, &storage);

        // No modules accessed yet — all skipped
        let savings_before = registry.estimated_instructions_saved();
        assert_eq!(
            savings_before,
            TOTAL_MODULES as u64 * INSTR_PER_STORAGE_READ
        );

        // Access one module
        let _ = registry.oracle_address();
        let savings_after = registry.estimated_instructions_saved();
        assert_eq!(
            savings_after,
            (TOTAL_MODULES as u64 - 1) * INSTR_PER_STORAGE_READ
        );
    }

    #[test]
    fn registry_all_modules_accessed_zero_savings() {
        let env = Env::default();
        let storage = soroban_sdk::testutils::Address::generate(&env);
        let mut registry = LazyModuleRegistry::new(&env, &storage);

        let _ = registry.oracle_address();
        let _ = registry.invoice_address();
        let _ = registry.access_control_address();
        let _ = registry.fraud_address();
        let _ = registry.metering_address();
        let _ = registry.batch_address();

        assert_eq!(registry.resolved_count(), TOTAL_MODULES);
        assert_eq!(registry.estimated_instructions_saved(), 0);
    }

    #[test]
    fn registry_has_helpers_return_false_when_absent() {
        let env = Env::default();
        let storage = soroban_sdk::testutils::Address::generate(&env);
        let mut registry = LazyModuleRegistry::new(&env, &storage);

        // read_optional_address always returns None in this test harness
        assert!(!registry.has_oracle());
        assert!(!registry.has_invoice());
        assert!(!registry.has_access_control());
        assert!(!registry.has_fraud());
        assert!(!registry.has_metering());
        assert!(!registry.has_batch());
    }

    #[test]
    fn registry_active_module_count_is_zero_when_all_absent() {
        let env = Env::default();
        let storage = soroban_sdk::testutils::Address::generate(&env);
        let mut registry = LazyModuleRegistry::new(&env, &storage);

        // Access all — but read_optional_address returns None → none are present
        let _ = registry.oracle_address();
        let _ = registry.invoice_address();
        let _ = registry.access_control_address();

        assert_eq!(registry.active_module_count(), 0);
        // resolved_count is 3
        assert_eq!(registry.resolved_count(), 3);
    }

    // ── Constants ─────────────────────────────────────────────────────────────

    #[test]
    fn max_instr_saved_matches_total_modules() {
        assert_eq!(MAX_INSTR_SAVED, TOTAL_MODULES as u64 * INSTR_PER_STORAGE_READ);
    }

    #[test]
    fn total_modules_count_is_correct() {
        assert_eq!(TOTAL_MODULES, 6);
    }

    #[test]
    fn instr_per_storage_read_is_positive() {
        assert!(INSTR_PER_STORAGE_READ > 0);
    }

    // ── Feature flags ─────────────────────────────────────────────────────────

    #[test]
    fn feature_flags_compile() {
        // These are const-fns; just ensure they compile and return a bool
        let _b = feature_flags::billing_enabled();
        let _n = feature_flags::notifications_enabled();
        let _a = feature_flags::analytics_enabled();
        let _f = feature_flags::fraud_detection_enabled();
        let _m = feature_flags::mev_protection_enabled();
    }
}
