use soroban_sdk::{Env, Symbol, String, val};

/// Standard structured log event for SubTrackr contracts.
/// By emitting these events, the off-chain indexing services can aggregate
/// contract logs and correlate them with backend requests using correlation_id.
pub struct ContractLogger;

impl ContractLogger {
    /// Log an informational event with an optional correlation_id
    pub fn info(env: &Env, message: &str, correlation_id: Option<String>) {
        Self::log(env, "info", message, correlation_id);
    }

    /// Log a warning event with an optional correlation_id
    pub fn warn(env: &Env, message: &str, correlation_id: Option<String>) {
        Self::log(env, "warn", message, correlation_id);
    }

    /// Log an error event with an optional correlation_id
    pub fn error(env: &Env, message: &str, correlation_id: Option<String>) {
        Self::log(env, "error", message, correlation_id);
    }

    fn log(env: &Env, level: &str, message: &str, correlation_id: Option<String>) {
        let topics = (Symbol::new(env, "structured_log"), Symbol::new(env, level));
        
        // Structure the log data
        let mut data_map = soroban_sdk::Map::new(env);
        data_map.set(Symbol::new(env, "msg"), String::from_str(env, message));
        
        if let Some(cid) = correlation_id {
            data_map.set(Symbol::new(env, "correlation_id"), cid);
        }

        env.events().publish(topics, data_map);
    }
}
