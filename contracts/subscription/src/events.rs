use soroban_sdk::{Address, Env};
use subtrackr_types::{
    Plan, Subscription, SubscriptionStatus, WebhookEventPayload, WebhookEventType,
    WebhookPlanSnapshot, WebhookSubscriptionSnapshot,
};

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
