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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TaxType {
    Vat,
    Gst,
    SalesTax,
    DigitalServicesTax,
    None,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxJurisdiction {
    pub country: String,
    pub state: String,
    pub city: String,
    pub postal_code: String,
    pub tax_type: TaxType,
    pub rate_bps: u32,
    pub label: String,
    pub effective_date: Timestamp,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum CertificateStatus {
    Pending,
    Valid,
    Expired,
    Revoked,
    Invalid,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxExemption {
    pub id: u64,
    pub customer: Address,
    pub certificate_number: String,
    pub issuing_authority: String,
    pub valid_from: Timestamp,
    pub valid_until: Timestamp,
    pub jurisdictions: Vec<TaxJurisdiction>,
    pub status: CertificateStatus,
    pub validated_at: Timestamp,
    pub validated_by: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DigitalGoodsCategory {
    Saas,
    Streaming,
    DigitalDownload,
    CloudStorage,
    OnlineService,
    InAppPurchase,
    Marketplace,
    Other,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxReportLineItem {
    pub invoice_id: u64,
    pub invoice_number: String,
    pub subscription_id: u64,
    pub customer: Address,
    pub taxable_amount: i128,
    pub tax_rate_bps: u32,
    pub tax_amount: i128,
    pub digital_goods_category: DigitalGoodsCategory,
    pub invoice_date: Timestamp,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum RemittanceStatus {
    Draft,
    Generated,
    Submitted,
    Paid,
    Amended,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxRemittanceReport {
    pub id: u64,
    pub period: TimeRange,
    pub jurisdiction: TaxJurisdiction,
    pub merchant: Address,
    pub total_taxable_amount: i128,
    pub total_tax_collected: i128,
    pub total_tax_remitted: i128,
    pub transaction_count: u32,
    pub line_items: Vec<TaxReportLineItem>,
    pub generated_at: Timestamp,
    pub submitted_at: Timestamp,
    pub status: RemittanceStatus,
    pub notes: String,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct NexusRegion {
    pub country: String,
    pub state: String,
    pub city: String,
    pub threshold_met: bool,
    pub threshold_amount: i128,
    pub transactions_in_period: u32,
    pub total_revenue_in_period: i128,
    pub first_nexus_date: Timestamp,
    pub tax_type: TaxType,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxRateChangeEvent {
    pub jurisdiction: TaxJurisdiction,
    pub old_rate_bps: u32,
    pub new_rate_bps: u32,
    pub effective_date: Timestamp,
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
pub type PaymentMethodId = u64;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TokenType {
    XLM,
    USDC,
    ETH,
    Native,
    MATIC,
    ARB,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum PaymentPriority {
    Primary,
    Backup,
    Fallback,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentMethod {
    pub id: PaymentMethodId,
    pub user: Address,
    pub token_type: TokenType,
    pub token_address: Address,
    pub chain_id: u64,
    pub label: String,
    pub priority: PaymentPriority,
    pub max_spend_per_interval: i128,
    pub is_verified: bool,
    pub is_active: bool,
    pub expires_at: u64,
    pub last_used_at: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub metadata: Vec<(String, String)>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum PaymentAttemptStatus {
    Pending,
    Success,
    Failed,
    FallbackTriggered,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentAttempt {
    pub id: u64,
    pub payment_method_id: PaymentMethodId,
    pub subscription_id: u64,
    pub amount: i128,
    pub token_type: TokenType,
    pub status: PaymentAttemptStatus,
    pub failure_reason: String,
    pub gas_price: i128,
    pub gas_used: u64,
    pub attempted_at: u64,
    pub resolved_at: u64,
}

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

// ── Tax System Types (extended) ──

/// Classification of digital goods for tax purposes (extended beyond DigitalGoodsCategory).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DigitalGoodsClass {
    Standard,
    ElectronicService,
    Exempt,
    ReducedRate,
    TelecomService,
}

/// A tax rate entry for a specific jurisdiction and tax type.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxRateEntry {
    pub jurisdiction_key: String,
    pub tax_type: TaxType,
    pub rate_bps: u32,
    pub display_name: String,
    pub effective_from: Timestamp,
    pub effective_until: Timestamp,
    pub applies_to_digital_goods: bool,
    pub reverse_charge: bool,
    pub nexus_threshold: i128,
}

/// Customer tax exemption status with certificate tracking.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CustomerTaxStatus {
    pub is_exempt: bool,
    pub certificate_id: String,
    pub certificate_expiry: Timestamp,
    pub issuing_authority: String,
    pub exempt_jurisdictions: Vec<String>,
    pub digital_goods_override: Option<DigitalGoodsClass>,
}

/// A single line in a tax remittance report recording collected tax by jurisdiction.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxRemittanceLineItem {
    pub jurisdiction_key: String,
    pub tax_type: TaxType,
    pub taxable_amount: i128,
    pub rate_bps: u32,
    pub tax_collected: i128,
    pub transaction_count: u32,
    pub currency: String,
}

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
    ProxyPrevImplCount,
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

    // ── Added in storage version 5 (Tax System) ──
    TaxJurisdiction(String),
    TaxExemption(u64),
    TaxExemptionCount,
    CustomerTaxExemption(Address),
    TaxRecord(u64),
    TaxRecordCount,
    TaxRecordByJurisdiction(String),
    TaxRemittanceReport(u64),
    TaxRemittanceReportCount,
    TaxRemittanceReportByJdx(String),
    TaxRateChangeLog(u64),
    TaxRateChangeLogCount,
    NexusRegion(String),

}
