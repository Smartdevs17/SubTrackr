/// Gas Profiling Module for SubTrackr Subscription Contract
/// Tracks gas consumption for each contract function and provides optimization insights
/// Updated for Issue #411: integrates with gas_optimization benchmark report.

use soroban_sdk::{Address, Env, String, Symbol, Vec};
use crate::gas_optimization::{audit_slots, benchmark_report};

/// Gas profile entry for a function call
#[derive(Clone)]
pub struct GasProfile {
    pub function_name: String,
    pub call_count: u64,
    pub total_gas: u64,
    pub min_gas: u64,
    pub max_gas: u64,
    pub avg_gas: u64,
    pub last_updated: u64,
}

/// Gas metrics thresholds and targets
#[derive(Clone)]
pub struct GasMetrics {
    pub function: String,
    pub warning_threshold: u64,
    pub error_threshold: u64,
    pub target_gas: u64,
    pub category: String, // "read", "write", "transfer", "complex"
}

/// Function complexity categories
pub enum FunctionCategory {
    Read,      // Simple read operations, < 50k gas
    Write,     // Storage write operations, 50k-150k gas
    Transfer,  // Token transfers, 100k-200k gas
    Complex,   // Multi-step operations, > 200k gas
}

impl FunctionCategory {
    pub fn to_string(&self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
            Self::Transfer => "transfer",
            Self::Complex => "complex",
        }
    }

    pub fn target_gas(&self) -> u64 {
        match self {
            Self::Read => 30_000,
            Self::Write => 80_000,
            Self::Transfer => 120_000,
            Self::Complex => 200_000,
        }
    }

    pub fn warning_threshold(&self) -> u64 {
        (self.target_gas() * 80) / 100 // 80% of target
    }

    pub fn error_threshold(&self) -> u64 {
        (self.target_gas() * 120) / 100 // 120% of target
    }
}

/// Storage keys for gas profiling data
pub enum GasStorageKey {
    Profile(String),                           // Function name -> GasProfile
    Metrics(String),                           // Function name -> GasMetrics
    DailyGasUsage(u64),                        // day timestamp -> total gas
    WeeklyGasUsage(u64),                       // week timestamp -> total gas
    MonthlyGasUsage(u64),                      // month timestamp -> total gas
    TotalGasUsed,                              // u64: cumulative gas used
    CallCount,                                 // u64: total number of calls
    GasAlertTriggered(String, u64),           // alert type -> count
}

/// Gas profiler implementation
pub struct GasProfiler;

impl GasProfiler {
    /// Record a function call with its gas consumption
    pub fn record_call(
        env: &Env,
        storage: &Address,
        function_name: &soroban_sdk::String,
        gas_used: u64,
        category: FunctionCategory,
    ) {
        let fname = function_name.clone();
        
        // Record function profile
        Self::update_profile(env, storage, &fname, gas_used);
        
        // Update daily/weekly/monthly tracking
        let now = env.ledger().timestamp();
        Self::update_time_series(env, storage, now, gas_used);
        
        // Check if gas usage exceeds thresholds
        Self::check_gas_thresholds(env, storage, &fname, gas_used, category);
        
        // Update total counters
        Self::increment_counters(env, storage, gas_used);
    }

    /// Update function profile statistics
    fn update_profile(env: &Env, storage: &Address, function_name: &String, gas_used: u64) {
        let key = GasStorageKey::Profile(function_name.clone());
        
        let mut profile: GasProfile = match Self::get_profile(env, storage, function_name) {
            Some(p) => p,
            None => GasProfile {
                function_name: function_name.clone(),
                call_count: 0,
                total_gas: 0,
                min_gas: u64::MAX,
                max_gas: 0,
                avg_gas: 0,
                last_updated: env.ledger().timestamp(),
            },
        };

        profile.call_count += 1;
        profile.total_gas += gas_used;
        profile.min_gas = if gas_used < profile.min_gas { gas_used } else { profile.min_gas };
        profile.max_gas = if gas_used > profile.max_gas { gas_used } else { profile.max_gas };
        profile.avg_gas = profile.total_gas / profile.call_count;
        profile.last_updated = env.ledger().timestamp();

        // Store would happen here - simplified for this interface
    }

    /// Get gas profile for a function
    pub fn get_profile(
        env: &Env,
        storage: &Address,
        function_name: &String,
    ) -> Option<GasProfile> {
        // This would retrieve from storage
        // Simplified for demonstration
        None
    }

    /// Update time series gas tracking (daily, weekly, monthly)
    fn update_time_series(env: &Env, storage: &Address, now: u64, gas_used: u64) {
        // Calculate day, week, month timestamps
        let secs_per_day = 86_400u64;
        let secs_per_week = 604_800u64;
        let secs_per_month = 2_592_000u64; // 30 days

        let day_ts = (now / secs_per_day) * secs_per_day;
        let week_ts = (now / secs_per_week) * secs_per_week;
        let month_ts = (now / secs_per_month) * secs_per_month;

        // Update daily, weekly, monthly aggregates
        // Storage operations would happen here
    }

    /// Check if gas usage exceeds optimization thresholds
    fn check_gas_thresholds(
        env: &Env,
        storage: &Address,
        function_name: &String,
        gas_used: u64,
        category: FunctionCategory,
    ) {
        let warning_threshold = category.warning_threshold();
        let error_threshold = category.error_threshold();

        if gas_used > error_threshold {
            // Trigger error alert
            env.events().publish(
                (String::from_str(env, "gas_error_alert"), function_name.clone()),
                (gas_used, error_threshold, category.to_string()),
            );
        } else if gas_used > warning_threshold {
            // Trigger warning alert
            env.events().publish(
                (String::from_str(env, "gas_warning_alert"), function_name.clone()),
                (gas_used, warning_threshold, category.to_string()),
            );
        }
    }

    /// Increment total counters
    fn increment_counters(env: &Env, storage: &Address, gas_used: u64) {
        // Update total gas used and call count
        // Storage operations would happen here
    }

    /// Get gas metrics summary for a function
    pub fn get_gas_metrics(
        env: &Env,
        storage: &Address,
        function_name: &str,
    ) -> Option<GasMetrics> {
        let fname = String::from_str(env, function_name);
        // Retrieve from storage
        None
    }

    /// Get all-time gas statistics
    pub fn get_total_stats(env: &Env, storage: &Address) -> (u64, u64, u64) {
        // Returns (total_gas_used, total_calls, average_gas_per_call)
        (0, 0, 0)
    }

    /// Get daily gas usage for a specific day
    pub fn get_daily_usage(env: &Env, storage: &Address, day_timestamp: u64) -> u64 {
        // Returns total gas used on that day
        0
    }

    /// Get weekly gas usage
    pub fn get_weekly_usage(env: &Env, storage: &Address, week_timestamp: u64) -> u64 {
        // Returns total gas used in that week
        0
    }

    /// Get monthly gas usage
    pub fn get_monthly_usage(env: &Env, storage: &Address, month_timestamp: u64) -> u64 {
        // Returns total gas used in that month
        0
    }

    /// Get functions exceeding thresholds
    pub fn get_high_gas_functions(
        env: &Env,
        storage: &Address,
        threshold_percentage: u64,
    ) -> Vec<(String, u64)> {
        // Returns list of (function_name, gas_used)
        // that exceed threshold_percentage of their targets
        soroban_sdk::vec![env]
    }

    /// Get optimization recommendations
    pub fn get_optimization_recommendations(
        env: &Env,
        _storage: &Address,
    ) -> Vec<String> {
        // Emit benchmark report as events for the monitoring dashboard
        let report = benchmark_report();
        for b in &report {
            env.events().publish(
                (String::from_str(env, "gas_benchmark"), String::from_str(env, b.operation)),
                (b.gas_before, b.gas_after, b.saving_pct),
            );
        }
        // Publish slot audit summary
        env.events().publish(
            (String::from_str(env, "slot_audit"),),
            (String::from_str(env, audit_slots()),),
        );
        soroban_sdk::vec![env]
    }
}

/// Macro for gas profiling - track function execution
/// Usage: gas_track!(env, storage, "function_name", FunctionCategory::Read);
#[macro_export]
macro_rules! gas_track {
    ($env:expr, $storage:expr, $name:expr, $category:expr) => {
        let start_gas = $env.budget().gas_used();
        let _gas_scope = GasTrackGuard::new(
            $env.clone(),
            $storage.clone(),
            String::from_str(&$env, $name),
            start_gas,
            $category,
        );
    };
}

/// Guard for automatic gas tracking on scope exit
pub struct GasTrackGuard {
    env: Env,
    storage: Address,
    function_name: String,
    start_gas: u64,
    category: fn() -> FunctionCategory,
}

impl GasTrackGuard {
    pub fn new(
        env: Env,
        storage: Address,
        function_name: String,
        start_gas: u64,
        _category: FunctionCategory,
    ) -> Self {
        GasTrackGuard {
            env,
            storage,
            function_name,
            start_gas,
            category: || FunctionCategory::Read,
        }
    }
}

impl Drop for GasTrackGuard {
    fn drop(&mut self) {
        // Record gas usage on scope exit
        let start = self.env.ledger().timestamp();
       let end = self.env.ledger().sequence();
       let gas_delta = end - start as u32; // Simplified for demonstration
        GasProfiler::record_call(
            &self.env,
            &self.storage,
            &self.function_name,
            gas_delta.into(),
            (self.category)(),
        );
    }
}
