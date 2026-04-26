// ════════════════════════════════════════════════════════════════
// DISPUTE RESOLUTION SYSTEM - Handle chargebacks and payment disputes
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
    AdminOwners,
    AdminThreshold,
    AdminTimelockDelaySeconds,
    AdminProposalSeq,
    AdminProposal,
    ContractVersion,
    // Dispute-specific keys
    Dispute(DisputeId),
    DisputeCount,
    DisputeByCharge(ChargeId),
    DisputeTimeline(DisputeId),
    DisputeEvidence(DisputeId),
    DisputeAnalytics,
}

/// Unique identifier for a dispute
#[derive(Clone)]
#[contracttype]
pub struct DisputeId {
    pub inner: u64,
}

/// Charge identifier from payment system
#[derive(Clone)]
#[contracttype]
pub struct ChargeId {
    pub inner: String,
}

impl DisputeId {
    pub fn new(env: &Env, value: u64) -> Self {
        DisputeId { inner: value }
    }

    pub fn to_val(&self) -> Val {
        self.inner.into_val(&Env::new())
    }
}

impl ChargeId {
    pub fn new(env: &Env, value: &str) -> Self {
        ChargeId {
            inner: String::from_str(env, value),
        }
    }
}

/// Dispute status enum
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum DisputeStatus {
    /// Dispute has been created but not yet submitted
    Pending = 0,
    /// Evidence is being collected
    GatheringEvidence = 1,
    /// Evidence submitted, awaiting review
    UnderReview = 2,
    /// Awaiting manual review decision
    AwaitingManualReview = 3,
    /// Dispute has been resolved
    Resolved = 4,
    /// Dispute was rejected
    Rejected = 5,
    /// Dispute expired due to time limit
    Expired = 6,
}

/// Dispute resolution outcome
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum Resolution {
    /// Dispute won - customer gets refund
    Refund = 0,
    /// Original charge upheld - no refund
    Upheld = 1,
    /// Partial refund granted
    PartialRefund = 2,
    /// Counter-claim successful
    Counter = 3,
    /// Settlement reached between parties
    Settlement = 4,
}

/// Evidence type for dispute
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum EvidenceType {
    /// Proof of delivery
    ProofOfDelivery = 0,
    /// Communication records
    Communication = 1,
    /// Contract/terms documentation
    Contract = 2,
    /// Receipt or invoice
    Receipt = 3,
    /// Product/service description
    ProductDescription = 4,
    /// Customer interaction history
    InteractionHistory = 5,
    /// Other evidence
    Other = 6,
}

/// Evidence submitted for dispute
#[derive(Clone)]
#[contracttype]
pub struct Evidence {
    /// Type of evidence
    pub evidence_type: EvidenceType,
    /// Description of the evidence
    pub description: String,
    /// URL or reference to evidence file
    pub reference: String,
    /// Timestamp when evidence was submitted
    pub submitted_at: u64,
    /// Who submitted the evidence
    pub submitted_by: Address,
}

/// Timeline event for dispute
#[derive(Clone)]
#[contracttype]
pub struct TimelineEvent {
    /// Event type
    pub event_type: TimelineEventType,
    /// Description of the event
    pub description: String,
    /// Timestamp of the event
    pub timestamp: u64,
    /// Who triggered the event
    pub triggered_by: Address,
}

/// Timeline event types
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum TimelineEventType {
    Created = 0,
    EvidenceSubmitted = 1,
    StatusChanged = 2,
    ManualReviewRequested = 3,
    Resolved = 4,
    Expired = 5,
}

/// Main dispute struct
#[derive(Clone)]
#[contracttype]
pub struct Dispute {
    /// Unique dispute identifier
    pub dispute_id: DisputeId,
    /// Charge ID this dispute is related to
    pub charge_id: ChargeId,
    /// Subscription ID (if applicable)
    pub subscription_id: Option<String>,
    /// User who created the dispute
    pub user: Address,
    /// Reason for the dispute
    pub reason: DisputeReason,
    /// Current status of the dispute
    pub status: DisputeStatus,
    /// Evidence submitted for this dispute
    pub evidence: Vec<Evidence>,
    /// Resolution (if resolved)
    pub resolution: Option<Resolution>,
    /// Resolution notes
    pub resolution_notes: Option<String>,
    /// When the dispute was created
    pub created_at: u64,
    /// When the dispute was last updated
    pub updated_at: u64,
    /// Deadline for submitting evidence
    pub evidence_deadline: u64,
    /// Resolution timestamp (if resolved)
    pub resolved_at: Option<u64>,
}

/// Dispute reasons
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum DisputeReason {
    /// Product/service not as described
    NotAsDescribed = 0,
    /// Product/service not received
    NotReceived = 0,
    /// Unauthorized charge
    Unauthorized = 1,
    /// Duplicate charge
    Duplicate = 2,
    /// Incorrect amount charged
    IncorrectAmount = 3,
    /// Subscription cancelled but charged
    CancelledSubscription = 4,
    /// Refund not processed
    RefundNotProcessed = 5,
    /// Other reason
    Other = 6,
}

/// Dispute analytics data
#[derive(Clone)]
#[contracttype]
pub struct DisputeAnalytics {
    /// Total disputes filed
    pub total_disputes: u64,
    /// Disputes won (refund)
    pub disputes_won: u64,
    /// Disputes lost (upheld)
    pub disputes_lost: u64,
    /// Disputes settled
    pub disputes_settled: u64,
    /// Pending disputes
    pub pending_disputes: u64,
    /// Average resolution time in seconds
    pub avg_resolution_time: u64,
    /// Total amount disputed
    pub total_amount_disputed: u64,
    /// Total amount refunded
    pub total_amount_refunded: u64,
}

/// Admin action for dispute management
#[derive(Clone)]
#[contracttype]
pub enum AdminAction {
    AddOwner(Address),
    RemoveOwner(Address),
    SetThreshold(u32),
    SetTimelockDelaySeconds(u64),
}

/// Admin proposal for dispute review
#[derive(Clone)]
#[contracttype]
pub struct AdminProposal {
    pub id: u64,
    pub action: AdminAction,
    pub created_at: u64,
    pub execute_after: u64,
    pub approvals: Vec<Address>,
}

// ════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════

/// Default evidence submission deadline (7 days in seconds)
const DEFAULT_EVIDENCE_DEADLINE_SECS: u64 = 604800;

/// Maximum evidence items per dispute
const MAX_EVIDENCE_PER_DISPUTE: u32 = 20;

/// Dispute analytics storage key
struct DisputeAnalyticsKey;

// ════════════════════════════════════════════════════════════════
// CONTRACT IMPLEMENTATION
// ════════════════════════════════════════════════════════════════

#[contract]
pub struct SubTrackrDispute;

#[contractimpl]
impl SubTrackrDispute {
    /// Initialize the dispute contract with an admin.
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

        // Initialize dispute analytics
        let analytics = DisputeAnalytics {
            total_disputes: 0,
            disputes_won: 0,
            disputes_lost: 0,
            disputes_settled: 0,
            pending_disputes: 0,
            avg_resolution_time: 0,
            total_amount_disputed: 0,
            total_amount_refunded: 0,
        };
        env.storage()
            .instance()
            .set(&DataKey::DisputeAnalytics, &analytics);

        env.events()
            .publish(Symbol::new(&env, "dispute_contract_initialized"), admin);
    }

    /// Create a new dispute from a chargeback notification.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `charge_id` - The charge ID to dispute
    /// * `reason` - The reason for the dispute
    /// * `subscription_id` - Optional subscription ID
    /// * `user` - The user creating the dispute
    ///
    /// # Returns
    /// * `DisputeId` - The created dispute's ID
    pub fn create_dispute(
        env: Env,
        charge_id: String,
        reason: DisputeReason,
        subscription_id: Option<String>,
        user: Address,
    ) -> DisputeId {
        user.require_auth();

        // Generate dispute ID
        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DisputeCount)
            .unwrap_or(0);
        count += 1;
        let dispute_id = DisputeId::new(&env, count);

        // Store dispute count
        env.storage()
            .instance()
            .set(&DataKey::DisputeCount, &count);

        // Create charge ID
        let charge = ChargeId::new(&env, &charge_id);

        // Calculate evidence deadline (7 days from now)
        let now = env.ledger().timestamp();
        let evidence_deadline = now + DEFAULT_EVIDENCE_DEADLINE_SECS;

        // Create the dispute
        let dispute = Dispute {
            dispute_id: dispute_id.clone(),
            charge_id: charge,
            subscription_id: subscription_id.clone(),
            user: user.clone(),
            reason,
            status: DisputeStatus::Pending,
            evidence: Vec::new(&env),
            resolution: None,
            resolution_notes: None,
            created_at: now,
            updated_at: now,
            evidence_deadline,
            resolved_at: None,
        };

        // Store the dispute
        env.storage()
            .instance()
            .set(&DataKey::Dispute(dispute_id.clone()), &dispute);

        // Index by charge ID
        env.storage()
            .instance()
            .set(&DataKey::DisputeByCharge(charge), &dispute_id);

        // Initialize timeline
        let mut timeline: Vec<TimelineEvent> = Vec::new(&env);
        timeline.push_back(TimelineEvent {
            event_type: TimelineEventType::Created,
            description: String::from_str(&env, "Dispute created"),
            timestamp: now,
            triggered_by: user,
        });
        env.storage()
            .instance()
            .set(&DataKey::DisputeTimeline(dispute_id.clone()), &timeline);

        // Update analytics
        Self::update_analytics(&env, true, 0, 0);

        // Emit event
        env.events().publish(
            Symbol::new(&env, "dispute_created"),
            (dispute_id.clone(), charge_id, reason),
        );

        dispute_id
    }

    /// Submit evidence for a dispute.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `dispute_id` - The dispute ID
    /// * `evidence_type` - Type of evidence
    /// * `description` - Evidence description
    /// * `reference` - Evidence reference/URL
    /// * `submitter` - Who is submitting the evidence
    pub fn submit_evidence(
        env: Env,
        dispute_id: DisputeId,
        evidence_type: EvidenceType,
        description: String,
        reference: String,
        submitter: Address,
    ) -> Result<(), String> {
        submitter.require_auth();

        // Get the dispute
        let key = DataKey::Dispute(dispute_id.clone());
        let mut dispute: Dispute = env
            .storage()
            .instance()
            .get(&key)
            .ok_or("Dispute not found")?;

        // Check if dispute is still active
        if dispute.status == DisputeStatus::Resolved
            || dispute.status == DisputeStatus::Rejected
            || dispute.status == DisputeStatus::Expired
        {
            return Err(String::from_str(&env, "Cannot submit evidence to resolved dispute"));
        }

        // Check evidence deadline
        let now = env.ledger().timestamp();
        if now > dispute.evidence_deadline {
            // Mark as expired
            dispute.status = DisputeStatus::Expired;
            dispute.updated_at = now;
            env.storage().instance().set(&key, &dispute);
            return Err(String::from_str(&env, "Evidence submission deadline passed"));
        }

        // Check max evidence limit
        if dispute.evidence.len() >= MAX_EVIDENCE_PER_DISPUTE {
            return Err(String::from_str(&env, "Maximum evidence limit reached"));
        }

        // Create evidence
        let evidence = Evidence {
            evidence_type,
            description,
            reference,
            submitted_at: now,
            submitted_by: submitter.clone(),
        };

        // Add evidence to dispute
        dispute.evidence.push_back(evidence);
        dispute.status = DisputeStatus::GatheringEvidence;
        dispute.updated_at = now;

        // Store updated dispute
        env.storage().instance().set(&key, &dispute);

        // Update timeline
        let timeline_key = DataKey::DisputeTimeline(dispute_id.clone());
        let mut timeline: Vec<TimelineEvent> = env
            .storage()
            .instance()
            .get(&timeline_key)
            .unwrap_or(Vec::new(&env));

        timeline.push_back(TimelineEvent {
            event_type: TimelineEventType::EvidenceSubmitted,
            description: String::from_str(&env, "Evidence submitted"),
            timestamp: now,
            triggered_by: submitter,
        });
        env.storage()
            .instance()
            .set(&timeline_key, &timeline);

        // Emit event
        env.events().publish(
            Symbol::new(&env, "evidence_submitted"),
            (dispute_id, evidence_type),
        );

        Ok(())
    }

    /// Request manual review for a dispute.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `dispute_id` - The dispute ID
    /// * `requester` - Who is requesting the review
    pub fn request_manual_review(
        env: Env,
        dispute_id: DisputeId,
        requester: Address,
    ) -> Result<(), String> {
        requester.require_auth();

        // Get the dispute
        let key = DataKey::Dispute(dispute_id.clone());
        let mut dispute: Dispute = env
            .storage()
            .instance()
            .get(&key)
            .ok_or("Dispute not found")?;

        // Check if dispute can be reviewed
        if dispute.status == DisputeStatus::Resolved
            || dispute.status == DisputeStatus::Rejected
            || dispute.status == DisputeStatus::Expired
        {
            return Err(String::from_str(&env, "Cannot request review for resolved dispute"));
        }

        // Update status
        dispute.status = DisputeStatus::AwaitingManualReview;
        dispute.updated_at = env.ledger().timestamp();

        // Store updated dispute
        env.storage().instance().set(&key, &dispute);

        // Update timeline
        let timeline_key = DataKey::DisputeTimeline(dispute_id.clone());
        let mut timeline: Vec<TimelineEvent> = env
            .storage()
            .instance()
            .get(&timeline_key)
            .unwrap_or(Vec::new(&env));

        timeline.push_back(TimelineEvent {
            event_type: TimelineEventType::ManualReviewRequested,
            description: String::from_str(&env, "Manual review requested"),
            timestamp: env.ledger().timestamp(),
            triggered_by: requester,
        });
        env.storage()
            .instance()
            .set(&timeline_key, &timeline);

        // Emit event
        env.events().publish(
            Symbol::new(&env, "manual_review_requested"),
            dispute_id,
        );

        Ok(())
    }

    /// Resolve a dispute with the given resolution.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `dispute_id` - The dispute ID
    /// * `resolution` - The resolution outcome
    /// * `resolution_notes` - Notes about the resolution
    /// * `resolver` - Who is resolving the dispute
    pub fn resolve_dispute(
        env: Env,
        dispute_id: DisputeId,
        resolution: Resolution,
        resolution_notes: Option<String>,
        resolver: Address,
    ) -> Result<(), String> {
        // Get the dispute
        let key = DataKey::Dispute(dispute_id.clone());
        let mut dispute: Dispute = env
            .storage()
            .instance()
            .get(&key)
            .ok_or("Dispute not found")?;

        // Check if dispute can be resolved
        if dispute.status == DisputeStatus::Resolved
            || dispute.status == DisputeStatus::Rejected
            || dispute.status == DisputeStatus::Expired
        {
            return Err(String::from_str(&env, "Dispute already resolved"));
        }

        let now = env.ledger().timestamp();

        // Update dispute
        dispute.status = DisputeStatus::Resolved;
        dispute.resolution = Some(resolution);
        dispute.resolution_notes = resolution_notes;
        dispute.updated_at = now;
        dispute.resolved_at = Some(now);

        // Store updated dispute
        env.storage().instance().set(&key, &dispute);

        // Update timeline
        let timeline_key = DataKey::DisputeTimeline(dispute_id.clone());
        let mut timeline: Vec<TimelineEvent> = env
            .storage()
            .instance()
            .get(&timeline_key)
            .unwrap_or(Vec::new(&env));

        timeline.push_back(TimelineEvent {
            event_type: TimelineEventType::Resolved,
            description: String::from_str(&env, "Dispute resolved"),
            timestamp: now,
            triggered_by: resolver,
        });
        env.storage()
            .instance()
            .set(&timeline_key, &timeline);

        // Update analytics based on resolution
        let (won, lost, settled) = match resolution {
            Resolution::Refund => (true, false, false),
            Resolution::Upheld => (false, true, false),
            Resolution::PartialRefund => (true, false, true),
            Resolution::Counter => (true, false, false),
            Resolution::Settlement => (false, false, true),
        };

        Self::update_analytics(&env, false, won, settled);

        // Emit event
        env.events().publish(
            Symbol::new(&env, "dispute_resolved"),
            (dispute_id, resolution),
        );

        Ok(())
    }

    /// Get a dispute by ID.
    pub fn get_dispute(env: Env, dispute_id: DisputeId) -> Option<Dispute> {
        env.storage()
            .instance()
            .get(&DataKey::Dispute(dispute_id))
    }

    /// Get dispute by charge ID.
    pub fn get_dispute_by_charge(env: Env, charge_id: String) -> Option<DisputeId> {
        let charge = ChargeId::new(&env, &charge_id);
        env.storage()
            .instance()
            .get(&DataKey::DisputeByCharge(charge))
    }

    /// Get dispute timeline.
    pub fn get_timeline(env: Env, dispute_id: DisputeId) -> Vec<TimelineEvent> {
        env.storage()
            .instance()
            .get(&DataKey::DisputeTimeline(dispute_id))
            .unwrap_or(Vec::new(&env))
    }

    /// Get dispute evidence.
    pub fn get_evidence(env: Env, dispute_id: DisputeId) -> Vec<Evidence> {
        let dispute: Option<Dispute> = env
            .storage()
            .instance()
            .get(&DataKey::Dispute(dispute_id));
        dispute.map(|d| d.evidence).unwrap_or(Vec::new(&env))
    }

    /// Get all disputes for a user.
    pub fn get_user_disputes(env: Env, user: Address) -> Vec<Dispute> {
        // This would require iterating through all disputes
        // In production, you'd want an index by user
        Vec::new(&env)
    }

    /// Get dispute analytics.
    pub fn get_analytics(env: Env) -> DisputeAnalytics {
        env.storage()
            .instance()
            .get(&DataKey::DisputeAnalytics)
            .unwrap_or(DisputeAnalytics {
                total_disputes: 0,
                disputes_won: 0,
                disputes_lost: 0,
                disputes_settled: 0,
                pending_disputes: 0,
                avg_resolution_time: 0,
                total_amount_disputed: 0,
                total_amount_refunded: 0,
            })
    }

    /// Check and update expired disputes.
    pub fn check_expired_disputes(env: Env) -> u32 {
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DisputeCount)
            .unwrap_or(0);

        let mut expired_count = 0;
        let now = env.ledger().timestamp();

        for i in 1..=count {
            let dispute_id = DisputeId::new(&env, i);
            let key = DataKey::Dispute(dispute_id.clone());

            if let Some(mut dispute) = env.storage().instance().get::<_, Dispute>(&key) {
                if dispute.status != DisputeStatus::Resolved
                    && dispute.status != DisputeStatus::Rejected
                    && dispute.status != DisputeStatus::Expired
                    && now > dispute.evidence_deadline
                {
                    dispute.status = DisputeStatus::Expired;
                    dispute.updated_at = now;
                    env.storage().instance().set(&key, &dispute);
                    expired_count += 1;
                }
            }
        }

        // Update analytics
        Self::update_analytics(&env, false, false, false);

        expired_count
    }

    /// Update dispute analytics.
    fn update_analytics(env: &Env, new_dispute: bool, won: bool, settled: bool) {
        let mut analytics: DisputeAnalytics = env
            .storage()
            .instance()
            .get(&DataKey::DisputeAnalytics)
            .unwrap_or(DisputeAnalytics {
                total_disputes: 0,
                disputes_won: 0,
                disputes_lost: 0,
                disputes_settled: 0,
                pending_disputes: 0,
                avg_resolution_time: 0,
                total_amount_disputed: 0,
                total_amount_refunded: 0,
            });

        if new_dispute {
            analytics.total_disputes += 1;
            analytics.pending_disputes += 1;
        } else {
            // Count pending
            let count: u64 = env
                .storage()
                .instance()
                .get(&DataKey::DisputeCount)
                .unwrap_or(0);

            let mut pending = 0u64;
            for i in 1..=count {
                let dispute_id = DisputeId::new(env, i);
                let key = DataKey::Dispute(dispute_id);

                if let Some(dispute) = env.storage().instance().get::<_, Dispute>(&key) {
                    if dispute.status != DisputeStatus::Resolved
                        && dispute.status != DisputeStatus::Rejected
                        && dispute.status != DisputeStatus::Expired
                    {
                        pending += 1;
                    }
                }
            }
            analytics.pending_disputes = pending;

            if won {
                analytics.disputes_won += 1;
            }
            if settled {
                analytics.disputes_settled += 1;
            }
            if !won && !settled && analytics.pending_disputes == 0 {
                // Must have been lost
                analytics.disputes_lost += 1;
            }
        }

        env.storage()
            .instance()
            .set(&DataKey::DisputeAnalytics, &analytics);
    }

    /// Get dispute count.
    pub fn get_dispute_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::DisputeCount)
            .unwrap_or(0)
    }
}