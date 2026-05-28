#![no_std]

use soroban_sdk::{contracttype, Address, String, Vec};

/// Billing interval in seconds.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Interval {
    Daily,     // 86400s
    Weekly,    // 604800s
    Monthly,   // 2592000s (30 days)
    Quarterly, // 7776000s (90 days)
    Yearly,    // 31536000s (365 days)
}

impl Interval {
    pub fn seconds(&self) -> u64 {
        match self {
            Interval::Daily => 86_400,
            Interval::Weekly => 604_800,
            Interval::Monthly => 2_592_000,
            Interval::Quarterly => 7_776_000,
            Interval::Yearly => 31_536_000,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SubscriptionStatus {
    Active,
    Paused,
    Cancelled,
    PastDue,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum InvoiceStatus {
    Draft,
    Sent,
    Partial,
    Paid,
    Void,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TimeRange {
    pub start: Timestamp,
    pub end: Timestamp,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct InvoiceLineItem {
    pub description: String,
    pub quantity: u32,
    pub unit_price: i128,
    pub currency: String,
    /// Exchange rate scaled by 1_000_000 to convert to invoice currency.
    pub exchange_rate: i128,
    pub tax_rate_bps: u32,
    pub line_total: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Invoice {
    pub id: u64,
    pub invoice_number: String,
    pub subscription_id: u64,
    pub subscriber: Address,
    pub merchant: Address,
    pub period: TimeRange,
    pub line_items: Vec<InvoiceLineItem>,
    pub subtotal: i128,
    pub tax: i128,
    pub total: i128,
    pub due_date: Timestamp,
    pub status: InvoiceStatus,
    pub currency: String,
    pub region: String,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct InvoiceConfig {
    pub numbering_prefix: String,
    pub numbering_padding: u32,
    pub default_currency: String,
    pub default_tax_bps: u32,
    pub exchange_rate_scale: i128,
    pub payment_terms_secs: Timestamp,
}

/// A subscription plan created by a merchant.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub id: u64,
    pub merchant: Address,
    pub name: String,
    pub price: i128,    // price per interval in stroops (XLM smallest unit)
    pub token: Address, // token address (native XLM or Stellar asset)
    pub interval: Interval,
    pub active: bool,
    pub subscriber_count: u32,
    pub created_at: u64,
}

/// A user's subscription to a plan.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Subscription {
    pub id: u64,
    pub plan_id: u64,
    pub subscriber: Address,
    pub status: SubscriptionStatus,
    pub started_at: u64,
    pub last_charged_at: u64,
    pub next_charge_at: u64,
    pub total_paid: i128,
    pub total_gas_spent: u64,
    pub charge_count: u32,
    pub paused_at: u64,
    pub pause_duration: u64,
    pub refund_requested_amount: i128,
}

pub type Timestamp = u64;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum UpgradeAction {
    Scheduled,
    Executed,
    RolledBack,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum QuotaMetric {
    ApiCalls,
    Storage, // in MB
    Seats,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum RolloverPolicy {
    NoRollover,
    RolloverAll,
    RolloverCap(u64),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Quota {
    pub metric: QuotaMetric,
    pub limit: u64,
    pub period: Interval,
    pub rollover_policy: RolloverPolicy,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct UsageRecord {
    pub subscription_id: u64,
    pub metric: QuotaMetric,
    pub current_usage: u64,
    pub period_start: u64,
    pub rollover_balance: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum QuotaStatus {
    WithinLimit,
    SoftLimitReached,
    HardLimitReached,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ScheduledUpgrade {
    pub implementation: Address,
    pub execute_after: Timestamp,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct UpgradeEvent {
    pub action: UpgradeAction,
    pub old_implementation: Address,
    pub new_implementation: Address,
    pub version_before: u32,
    pub version_after: u32,
    pub scheduled_for: Timestamp,
    pub executed_at: Timestamp,
}

pub type SubscriptionId = u64;
pub type MerchantId = Address;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum FraudAction {
    Approve,
    Flag,
    Block,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum FraudReviewStatus {
    Pending,
    Reviewed,
    Dismissed,
    Escalated,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum RiskSignalKind {
    Velocity,
    UsageAnomaly,
    Chargeback,
    PatternShift,
    DeviceMismatch,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RiskSignal {
    pub kind: RiskSignalKind,
    pub score: u32,
    pub detail: String,
    pub observed_at: Timestamp,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RiskScore {
    pub subscriber: Address,
    pub subscription_id: SubscriptionId,
    pub merchant_id: MerchantId,
    pub total_score: u32,
    pub velocity_score: u32,
    pub anomaly_score: u32,
    pub chargeback_score: u32,
    pub action: FraudAction,
    pub reason: String,
    pub assessed_at: Timestamp,
    pub signals: Vec<RiskSignal>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FraudCase {
    pub case_id: u64,
    pub subscription_id: SubscriptionId,
    pub subscriber: Address,
    pub merchant_id: MerchantId,
    pub risk_score: u32,
    pub action: FraudAction,
    pub status: FraudReviewStatus,
    pub reason: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FraudReport {
    pub merchant_id: MerchantId,
    pub total_subscriptions: u32,
    pub flagged_subscriptions: u32,
    pub blocked_subscriptions: u32,
    pub manual_review_count: u32,
    pub average_risk: u32,
    pub velocity_alerts: u32,
    pub anomaly_alerts: u32,
    pub chargeback_predictions: u32,
    pub high_risk_subscribers: u32,
    pub recent_cases: Vec<FraudCase>,
}

// ── Access Control Types ──

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Role {
    Admin,
    Merchant,
    Subscriber,
    Auditor,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Permission {
    GrantRole,
    RevokeRole,
    DelegatePermission,
    CreatePlan,
    DeactivatePlan,
    SetPlanQuotas,
    SetRevenueRule,
    Subscribe,
    CancelSubscription,
    PauseSubscription,
    ResumeSubscription,
    ChargeSubscription,
    RequestRefund,
    ApproveRefund,
    RejectRefund,
    RequestTransfer,
    AcceptTransfer,
    SetRateLimit,
    RemoveRateLimit,
    SetInvoiceContract,
    ClearInvoiceContract,
    UpgradeContract,
    MigrateContract,
    ViewAnalytics,
    ViewAuditLog,
    ViewPlans,
    ViewSubscriptions,
    SetEmergencyAdmin,
    PauseEmergency,
    SetAccessControl,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum RoleChangeAction {
    Granted,
    Revoked,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RoleChangeEntry {
    pub id: u64,
    pub user: Address,
    pub role: Role,
    pub action: RoleChangeAction,
    pub changed_by: Address,
    pub timestamp: u64,
}

// ── Storage Keys ──

/// Storage keys for the proxy contract state.
///
/// IMPORTANT: Never reorder existing variants. Append new variants only.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum StorageKey {
    // ── Subscription state ──
    Plan(u64),
    PlanCount,
    Subscription(u64),
    SubscriptionCount,
    UserSubscriptions(Address),
    MerchantPlans(Address),
    Admin,
    /// Minimum seconds between calls for a given function (by name)
    RateLimit(String),
    /// Last timestamp (seconds) a caller invoked a function (by function name)
    LastCall(Address, String),
    /// Pending transfer request: subscription_id -> pending recipient
    PendingTransfer(u64),

    // ── Invoice state ──
    InvoiceCount,
    Invoice(u64),
    InvoiceBySubscription(u64),
    InvoiceConfig,
    TaxRate(String),
    ExchangeRate(String),
    InvoiceContract,

    // ── Proxy upgrade state ──
    ProxyImplementation,
    ProxyVersion,
    ProxyUpgradeDelaySecs,
    ProxyRollbackDelaySecs,
    ProxyScheduledUpgrade,
    ProxyPreviousImplementationCount,
    ProxyPreviousImplementation(u32),
    ProxyUpgradeHistoryCount,
    ProxyUpgradeHistoryEntry(u32),

    // ── Added in storage version 2 ──
    /// Index: (subscriber, plan_id) -> subscription_id (active/non-cancelled)
    UserPlanIndex(Address, u64),

    // ── Added in storage version 3 ──
    WebhookCount,
    Webhook(u64),
    MerchantWebhooks(Address),
    WebhookDeliveryCount,
    WebhookDelivery(u64),
    WebhookDeliveriesByWebhook(u64),

    /// Proxy pointer to the state storage contract.
    ProxyStorage,

    // ── Revenue recognition (added with revenue module) ──
    /// RevenueRecognitionRule keyed by plan_id.
    RevenueRecognitionRule(u64),
    /// RevenueSchedule keyed by subscription_id.
    RevenueSchedule(u64),
    /// Cumulative deferred revenue balance for a merchant.
    RevenueDeferredBalance(Address),
    /// Cumulative recognised revenue balance for a merchant.
    RevenueRecognisedBalance(Address),
    /// List of subscription IDs tracked for a merchant (for analytics).
    RevenueMerchantSubscriptions(Address),

    // ── Added in storage version 4 (Quota & Usage) ──
    /// List of quotas for a given plan (plan_id -> Vec<Quota>)
    PlanQuotas(u64),
    /// Usage record for a subscription and metric (sub_id, metric -> UsageRecord)
    SubscriptionUsage(u64, QuotaMetric),

    // ── Added in storage version 5 (Access Control) ──
    /// Address of the access_control contract for RBAC.
    AccessControl,
}
