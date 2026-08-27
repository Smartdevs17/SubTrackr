//! Lazy Loading for Soroban Smart Contract Modules — SubTrackr
//!
//! Provides deferred initialization and lazy loading patterns for Soroban
//! contract modules to reduce initial deployment cost and startup time.

use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol};

/// Module lifecycle states for lazy-loaded modules.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ModuleState {
    /// Module has not been loaded yet.
    Unloaded,
    /// Module is currently being initialized.
    Loading,
    /// Module is loaded and ready for use.
    Loaded,
    /// Module failed to load.
    Failed,
}

/// Registry entry for a lazy-loaded module.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ModuleEntry {
    pub name: Symbol,
    pub state: ModuleState,
    pub version: u32,
    pub loaded_at: u64,
    pub storage_key: Symbol,
}

/// Lazy loader that manages deferred module initialization.
pub struct LazyModuleLoader;

const MODULE_REGISTRY: Symbol = symbol_short!("MOD_REG");

impl LazyModuleLoader {
    /// Register a module for lazy loading.
    pub fn register(env: &Env, name: Symbol, version: u32) {
        let entry = ModuleEntry {
            name: name.clone(),
            state: ModuleState::Unloaded,
            version,
            loaded_at: 0,
            storage_key: name.clone(),
        };

        env.storage()
            .instance()
            .set(&(MODULE_REGISTRY, name), &entry);
    }

    /// Check if a module is loaded.
    pub fn is_loaded(env: &Env, name: &Symbol) -> bool {
        let entry: Option<ModuleEntry> = env
            .storage()
            .instance()
            .get(&(MODULE_REGISTRY, name.clone()));

        matches!(entry, Some(e) if e.state == ModuleState::Loaded)
    }

    /// Get module state.
    pub fn get_state(env: &Env, name: &Symbol) -> ModuleState {
        let entry: Option<ModuleEntry> = env
            .storage()
            .instance()
            .get(&(MODULE_REGISTRY, name.clone()));

        entry.map(|e| e.state).unwrap_or(ModuleState::Unloaded)
    }

    /// Mark a module as loading (prevents re-entrant initialization).
    pub fn begin_load(env: &Env, name: &Symbol) -> bool {
        let entry: Option<ModuleEntry> = env
            .storage()
            .instance()
            .get(&(MODULE_REGISTRY, name.clone()));

        match entry {
            Some(mut e) => {
                if e.state == ModuleState::Unloaded || e.state == ModuleState::Failed {
                    e.state = ModuleState::Loading;
                    env.storage()
                        .instance()
                        .set(&(MODULE_REGISTRY, name.clone()), &e);
                    true
                } else {
                    false
                }
            }
            None => false,
        }
    }

    /// Mark a module as loaded after successful initialization.
    pub fn end_load(env: &Env, name: &Symbol) {
        let entry: Option<ModuleEntry> = env
            .storage()
            .instance()
            .get(&(MODULE_REGISTRY, name.clone()));

        if let Some(mut e) = entry {
            e.state = ModuleState::Loaded;
            e.loaded_at = env.ledger().timestamp();
            env.storage()
                .instance()
                .set(&(MODULE_REGISTRY, name.clone()), &e);
        }
    }

    /// Mark a module as failed.
    pub fn mark_failed(env: &Env, name: &Symbol) {
        let entry: Option<ModuleEntry> = env
            .storage()
            .instance()
            .get(&(MODULE_REGISTRY, name.clone()));

        if let Some(mut e) = entry {
            e.state = ModuleState::Failed;
            env.storage()
                .instance()
                .set(&(MODULE_REGISTRY, name.clone()), &e);
        }
    }

    /// Get all registered modules and their states.
    pub fn list_modules(env: &Env) -> Vec<ModuleEntry> {
        env.storage()
            .instance()
            .get::<_, soroban_sdk::Vec<ModuleEntry>>(&MODULE_REGISTRY)
            .unwrap_or(soroban_sdk::Vec::new(env))
    }
}

/// Trait for modules that support lazy initialization.
pub trait LazyModule {
    /// The module name used for registration.
    fn module_name() -> Symbol;

    /// Initialize the module. Called once when first accessed.
    fn initialize(env: &Env) -> Result<(), Symbol>;

    /// Version of this module.
    fn version() -> u32 {
        1
    }
}

/// Execute a lazy-loaded module action, initializing on first use.
pub fn with_module<M: LazyModule, F, R>(env: &Env, f: F) -> Result<R, Symbol>
where
    F: FnOnce(&Env) -> Result<R, Symbol>,
{
    let name = M::module_name();

    if LazyModuleLoader::is_loaded(env, &name) {
        return f(env);
    }

    if LazyModuleLoader::begin_load(env, &name) {
        match M::initialize(env) {
            Ok(()) => {
                LazyModuleLoader::end_load(env, &name);
                f(env)
            }
            Err(e) => {
                LazyModuleLoader::mark_failed(env, &name);
                Err(e)
            }
        }
    } else {
        Err(symbol_short!("BUSY"))
    }
}

/// Pre-warm a module (load it eagerly if not already loaded).
pub fn preload<M: LazyModule>(env: &Env) -> Result<(), Symbol> {
    let name = M::module_name();

    if LazyModuleLoader::is_loaded(env, &name) {
        return Ok(());
    }

    if LazyModuleLoader::begin_load(env, &name) {
        match M::initialize(env) {
            Ok(()) => {
                LazyModuleLoader::end_load(env, &name);
                Ok(())
            }
            Err(e) => {
                LazyModuleLoader::mark_failed(env, &name);
                Err(e)
            }
        }
    } else {
        Ok(())
    }
}
