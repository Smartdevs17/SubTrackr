use soroban_sdk::{contracttype, Address, Env, String, Vec};
use subtrackr_types::{
    Plan, Subscription, SubscriptionStatus, WebhookEventPayload, WebhookEventType,
    WebhookPlanSnapshot, WebhookSubscriptionSnapshot,
};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SubscriptionEventType {
    Created,
    Updated,
    Renewed,
    Cancelled,
    PaymentFailed,
    Upgraded,
    Paused,
    Resumed,
    RefundRequested,
    RefundApproved,
    RefundRejected,
    TransferRequested,
    TransferAccepted,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionAuditEvent {
    pub id: u64,
    pub subscription_id: u64,
    pub sequence: u64,
    pub event_type: SubscriptionEventType,
    pub actor: Address,
    pub occurred_at: u64,
    pub schema_version: u32,
    pub payload_hash: String,
}

pub(crate) fn build_audit_event(
    env: &Env,
    subscription_id: u64,
    sequence: u64,
    event_type: SubscriptionEventType,
    actor: &Address,
    payload_hash: String,
) -> SubscriptionAuditEvent {
    SubscriptionAuditEvent {
        id: env.ledger().sequence() as u64,
        subscription_id,
        sequence,
        event_type,
        actor: actor.clone(),
        occurred_at: env.ledger().timestamp(),
        schema_version: 1,
        payload_hash,
    }
}

pub(crate) fn replay_state(events: Vec<SubscriptionAuditEvent>) -> Option<SubscriptionEventType> {
    let mut latest: Option<SubscriptionEventType> = None;
    for event in events.iter() {
        latest = Some(event.event_type);
    }
    latest
}

pub(crate) fn subscription_snapshot(sub: &Subscription) -> WebhookSubscriptionSnapshot {
    WebhookSubscriptionSnapshot {
        id: sub.id,
        plan_id: sub.plan_id,
        subscriber: sub.subscriber.clone(),
        status: sub.status.clone(),
        started_at: sub.started_at,
        last_charged_at: sub.last_charged_at,
        next_charge_at: sub.next_charge_at,
        total_paid: sub.total_paid,
        total_gas_spent: sub.total_gas_spent,
        charge_count: sub.charge_count,
        paused_at: sub.paused_at,
        pause_duration: sub.pause_duration,
        refund_requested_amount: sub.refund_requested_amount,
    }
}

pub(crate) fn plan_snapshot(plan: &Plan) -> WebhookPlanSnapshot {
    WebhookPlanSnapshot {
        id: plan.id,
        merchant: plan.merchant.clone(),
        name: plan.name.clone(),
        price: plan.price,
        token: plan.token.clone(),
        interval: plan.interval.clone(),
        active: plan.active,
        subscriber_count: plan.subscriber_count,
        created_at: plan.created_at,
    }
}

pub(crate) fn build_payload(
    env: &Env,
    webhook_id: u64,
    event_type: WebhookEventType,
    merchant: &Address,
    subscription: &Subscription,
    plan: &Plan,
    previous_status: SubscriptionStatus,
) -> WebhookEventPayload {
    WebhookEventPayload {
        id: env.ledger().timestamp(),
        webhook_id,
        event_type,
        merchant: merchant.clone(),
        occurred_at: env.ledger().timestamp(),
        subscription: subscription_snapshot(subscription),
        plan: plan_snapshot(plan),
        previous_status,
        current_status: subscription.status.clone(),
    }
}
