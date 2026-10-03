#![no_std]
// TODO: migrate `env.events().publish(..)` to the `#[contractevent]` macro.
// soroban-sdk 28 deprecated the imperative form; it is still functional and
// still emits identical events, so the deprecation is allowed crate-wide
// until the event payloads are reworked. CI lints with `-D warnings`.
#![allow(deprecated)]
pub mod errors;
pub use errors::CoreError;

use soroban_sdk::{contracttype, Address, BytesN, String, Vec};

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

/// MEV protection settings for subscription charges.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MevProtectionConfig {
    /// Charges at or above this amount must use commit-reveal.
    pub large_charge_threshold: i128,
    /// Maximum subscriber-defined fee/price buffer in basis points.
    pub max_fee_bps: u32,
    /// Minimum delay between commit and reveal.
    pub reveal_delay_secs: Timestamp,
    /// Maximum lifetime of a pending commitment.
    pub commit_ttl_secs: Timestamp,
    /// Require the reveal transaction to come through the configured private path.
    pub private_mempool_required: bool,
    /// Gas price above this value records an MEV alert.
    pub gas_price_alert_threshold: u64,
}

/// Pending commit-reveal envelope for a subscription charge.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ChargeCommitment {
    pub subscription_id: SubscriptionId,
    pub subscriber: Address,
    pub commitment: BytesN<32>,
    pub committed_at: Timestamp,
    pub min_reveal_at: Timestamp,
    pub expires_at: Timestamp,
}

/// Monitoring record for suspicious fee/gas conditions around a charge.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MevAlert {
    pub id: u64,
    pub subscription_id: SubscriptionId,
    pub observed_gas_price: u64,
    pub threshold: u64,
    pub detected_at: Timestamp,
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

    // Added for MEV-resistant subscription charging
    MevProtectionConfig,
    ChargeCommitment(u64),
    MevAlertCount,
    MevAlert(u64),

    // Plan and payment method storage keys
    MaxPlansPerMerchant,
    UserPaymentMethods(Address),
    PaymentMethodEntry(Address, u64),
    PaymentMethodCount(Address),

    // ── Access control (pointer to the access_control contract) ──
    /// Address of the access-control contract guarding this state.
    AccessControl,

    // ── Tax engine (added with the tax compliance module) ──
    /// Tax rate entry for a jurisdiction id (`TaxJurisdiction`).
    TaxRateEntry(String),
    /// Append-only log of rate changes for a jurisdiction id.
    TaxRateChangeLogByJdx(String),
    /// Whether a customer is a tax-exempt / registered entity.
    CustomerTaxStatus(Address),
    /// Digital-goods classification for a plan.
    DigitalGoodsClass(u64),
    /// A single line of a remittance report, keyed by invoice and jurisdiction.
    TaxRemittanceLine(u64, String),
    /// Persisted remittance report by id.
    TaxRemittanceReport(u64),
    /// Number of remittance reports issued so far.
    TaxRemittanceReportCount,
}

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
    pub timestamp: Timestamp,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceBounds {
    pub min_price_bps: u32,
    pub max_price_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BillingSchedule {
    pub subscription_id: u64,
    pub interval: Interval,
    pub start_date: u64,
    pub custom_invoice_day: u32,
    pub promotional_duration_days: u32,
    pub promotional_rate: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ChargeStatus {
    Pending,
    Attempting,
    Completed,
    Failed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ChargeAttempt {
    pub id: u64,
    pub subscription_id: u64,
    pub status: ChargeStatus,
    pub amount: i128,
    pub attempted_at: u64,
    pub completed_at: u64,
    pub error_message: String,
    pub retry_count: u32,
    pub max_retries: u32,
    pub next_retry_at: u64,
    pub circuit_breaker_until: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RetryConfig {
    pub max_retries: u32,
    pub base_delay_secs: u64,
    pub max_delay_secs: u64,
    pub backoff_factor: u32,
    pub circuit_breaker_threshold: u32,
    pub circuit_breaker_cooldown_secs: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum WebhookEventType {
    SubscriptionCreated,
    SubscriptionUpdated,
    SubscriptionCancelled,
    SubscriptionRenewed,
    PaymentFailed,
    ChargeSucceeded,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct WebhookSubscriptionSnapshot {
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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct WebhookPlanSnapshot {
    pub id: u64,
    pub merchant: Address,
    pub name: String,
    pub price: i128,
    pub token: Address,
    pub interval: Interval,
    pub active: bool,
    pub subscriber_count: u32,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct WebhookEventPayload {
    pub id: u64,
    pub webhook_id: u64,
    pub event_type: WebhookEventType,
    pub merchant: Address,
    pub occurred_at: u64,
    pub subscription: WebhookSubscriptionSnapshot,
    pub plan: WebhookPlanSnapshot,
    pub previous_status: SubscriptionStatus,
    pub current_status: SubscriptionStatus,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct LoyaltyTierConfig {
    pub name: String,
    pub min_points: u64,
    pub discount_bps: u32,
    pub multiplier: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct LoyaltyConfig {
    pub enabled: bool,
    pub points_per_stroop: u64,
    pub streak_bonus_pct: u32,
    pub referral_points: u64,
    pub min_redemption_points: u64,
    pub points_expiry_days: u32,
    pub tiers: Vec<LoyaltyTierConfig>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum PointTxType {
    Earned,
    Redeemed,
    Expired,
    Bonus,
    Referral,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PointTransaction {
    pub id: u64,
    pub subscriber: Address,
    pub tx_type: PointTxType,
    pub amount: u64,
    pub timestamp: u64,
    pub description: String,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RewardsRedemption {
    pub id: u64,
    pub subscriber: Address,
    pub points_used: u64,
    pub discount_applied: i128,
    pub redeemed_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TokenType {
    StellarAsset,
    NativeXLM,
    Custom,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum PaymentPriority {
    Primary,
    Backup,
    Fallback,
}

pub type PaymentMethodId = u64;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentMethod {
    pub id: u64,
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
    pub metadata: Vec<String>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TemplateKey {
    Template(u64),
    TemplateCount,
    MerchantTemplates(Address),
    SharedTemplates,
    TemplateAnalytics(u64),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum WebhookDeliveryStatus {
    Pending,
    Delivered,
    Failed,
    Retrying,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct WebhookRetryPolicy {
    pub max_retries: u32,
    pub backoff_seconds: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct WebhookConfig {
    pub id: u64,
    pub merchant: Address,
    pub url: String,
    pub secret: String,
    pub events: Vec<WebhookEventType>,
    pub is_paused: bool,
    pub created_at: u64,
    pub failure_count: u32,
    pub retry_policy: WebhookRetryPolicy,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct WebhookDelivery {
    pub id: u64,
    pub webhook_id: u64,
    pub event_type: WebhookEventType,
    pub payload_hash: String,
    pub status: WebhookDeliveryStatus,
    pub attempts: u32,
    pub next_attempt_at: u64,
    pub last_attempt_at: u64,
    pub response_status: u32,
}

// ─────────────────────────────────────────────────────────
// API keys and rate limiting
// ─────────────────────────────────────────────────────────

/// Monotonically increasing identifier for an issued API key.
pub type ApiKeyId = u64;

/// Lifecycle state of an API key.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ApiKeyStatus {
    Active,
    Revoked,
    Expired,
}

/// Request allowances enforced over each rolling window.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RateLimitConfig {
    pub requests_per_minute: u32,
    pub requests_per_hour: u32,
    pub requests_per_day: u32,
    /// Maximum number of requests permitted back-to-back within a window.
    pub burst_limit: u32,
}

/// Metered-usage pricing tier applied when billing an API key.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum UsageTier {
    Free,
    Basic,
    Pro,
    Enterprise,
}

impl UsageTier {
    /// Price per 1,000 billable requests, in the smallest token unit.
    pub fn price_per_thousand(&self) -> i128 {
        match self {
            UsageTier::Free => 0,
            UsageTier::Basic => 1_000,
            UsageTier::Pro => 5_000,
            UsageTier::Enterprise => 20_000,
        }
    }
}

/// Parameters supplied when creating a new API key.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ApiKeyConfig {
    pub name: String,
    pub rate_limit: RateLimitConfig,
    pub usage_tier: UsageTier,
    /// Unix timestamp after which the key stops validating; `0` means never.
    pub expires_at: Timestamp,
}

/// A stored API key. The raw secret is returned once at creation and only
/// its SHA-256 hash is retained on-chain.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ApiKey {
    pub id: ApiKeyId,
    pub owner: Address,
    pub key_hash: BytesN<32>,
    pub name: String,
    pub rate_limit: RateLimitConfig,
    pub usage_tier: UsageTier,
    pub status: ApiKeyStatus,
    pub created_at: Timestamp,
    pub expires_at: Timestamp,
    pub last_used_at: Timestamp,
    pub revoked_at: Timestamp,
}

/// One entry in an API key's audit trail.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ApiKeyAuditEntry {
    pub id: u64,
    pub key_id: ApiKeyId,
    pub action: String,
    pub changed_by: Address,
    pub timestamp: Timestamp,
}

/// Request counter for a single rate-limit window.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ApiUsageRecord {
    pub window_start: Timestamp,
    pub count: u32,
}

/// Outcome of a rate-limit check.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RateLimitStatus {
    pub is_allowed: bool,
    /// Requests still available in the most constrained window.
    pub remaining: u32,
    /// Timestamp at which the earliest window resets.
    pub reset_at: Timestamp,
    /// Seconds the caller should wait before retrying; `0` when allowed.
    pub retry_after: Timestamp,
}

/// Aggregated request usage for a key over a period.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct UsageReport {
    pub key_id: ApiKeyId,
    pub period: TimeRange,
    pub total_requests: u32,
}

// ── Tax ──────────────────────────────────────────────────────────────────────

/// Kind of tax a rate applies to.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaxType {
    None,
    SalesTax,
    Vat,
    Gst,
    Excise,
    Withholding,
    UseTax,
    Other,
}

/// How a subscription is classified for digital-goods tax purposes.
///
/// The classification decides whether digital-goods rates, reduced rates, or
/// exemptions apply to a charge.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DigitalGoodsClass {
    /// Subscription access delivered over a network (SaaS, streaming, API).
    ElectronicService,
    /// Digitally delivered goods such as licences or downloads.
    Downloadable,
    /// Physical goods shipped to the customer.
    PhysicalGoods,
    Other,
}

/// Coarse product grouping used by remittance reporting.
///
/// Distinct from [`DigitalGoodsClass`]: this is a reporting dimension chosen
/// by the merchant rather than a tax determination.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DigitalGoodsCategory {
    Saas,
    Streaming,
    Software,
    Services,
    PhysicalGoods,
    Other,
}

/// A customer-supplied override of the plan's [`DigitalGoodsClass`].
///
/// Modelled as its own enum rather than `Option<DigitalGoodsClass>` because
/// Soroban contract types cannot carry `Option` fields.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MaybeDigitalGoodsClass {
    /// No override; fall back to the plan's classification.
    None,
    /// Customer-provided classification that wins over the plan's.
    Overridden(DigitalGoodsClass),
}

/// Tax treatment recorded for a customer.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CustomerTaxStatus {
    /// Whether the customer qualifies for an exemption.
    pub is_exempt: bool,
    /// Identifier of the exemption certificate, empty when not exempt.
    pub certificate_id: String,
    /// Ledger timestamp after which the certificate is no longer valid; zero
    /// means the exemption does not expire.
    pub certificate_expiry: u64,
    /// Authority that issued the certificate.
    pub issuing_authority: String,
    /// Jurisdictions the exemption applies to; empty means all of them.
    pub exempt_jurisdictions: Vec<String>,
    /// Customer override of the plan's digital-goods classification.
    pub digital_goods_override: MaybeDigitalGoodsClass,
}

/// Geographic scope a tax rate belongs to.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxJurisdiction {
    pub country: String,
    pub state: String,
    pub city: String,
    pub postal_code: String,
    pub tax_type: TaxType,
    pub rate_bps: u32,
    /// Human-readable name shown on an invoice.
    pub label: String,
    pub effective_date: u64,
}

/// An effective tax rate for one jurisdiction.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxRateEntry {
    /// Lookup key, most specific first (`country-state-city`, then
    /// `country-state`, then `country`, then `GLOBAL`).
    pub jurisdiction_key: String,
    pub tax_type: TaxType,
    /// Rate in basis points, so 1000 == 10%.
    pub rate_bps: u32,
    pub display_name: String,
    pub effective_from: u64,
    /// Timestamp the rate stops applying; zero means it never expires.
    pub effective_until: u64,
    pub applies_to_digital_goods: bool,
    /// Whether the customer, rather than the merchant, remits the tax.
    pub reverse_charge: bool,
    /// Registration threshold below which no tax is due in this jurisdiction.
    pub nexus_threshold: i128,
}

/// Record of a rate change, appended to a jurisdiction's change log.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxRateChangeEvent {
    pub jurisdiction: TaxJurisdiction,
    pub old_rate_bps: u32,
    pub new_rate_bps: u32,
    pub effective_date: u64,
}

/// Aggregated tax owed for one invoice in one jurisdiction.
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

/// A single invoice's contribution to a remittance report.
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
    pub invoice_date: u64,
}

/// Lifecycle state of a remittance report.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RemittanceStatus {
    Draft,
    Submitted,
    Filed,
    Paid,
    Void,
}

/// Tax owed over a period, grouped for filing.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TaxRemittanceReport {
    pub id: u64,
    pub period: TimeRange,
    pub jurisdiction: TaxJurisdiction,
    /// Merchant the report is filed for.
    pub merchant: Address,
    pub total_taxable_amount: i128,
    pub total_tax_collected: i128,
    /// Amount actually remitted; zero until a settlement is recorded.
    pub total_tax_remitted: i128,
    pub transaction_count: u32,
    pub line_items: Vec<TaxReportLineItem>,
    pub generated_at: u64,
    /// Timestamp the report was submitted; zero while still a draft.
    pub submitted_at: u64,
    pub status: RemittanceStatus,
    pub notes: String,
}
