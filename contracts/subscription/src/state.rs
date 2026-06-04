use soroban_sdk::{Address, Env, Vec};
use subtrackr_types::{Subscription, SubscriptionStatus};

use crate::errors::ContractError;
use crate::events::{StoredEvent, SubscriptionEventType};
use crate::event_store;

/// Reconstruct the current subscription state by replaying all events.
pub(crate) fn reconstruct_state(
    env: &Env,
    subscription_id: u64,
) -> Option<Subscription> {
    let ids = event_store::read_event_ids(env, subscription_id);

    if ids.len() == 0 {
        return None;
    }

    let mut subscriber_set = false;
    let mut sub = Subscription {
        id: subscription_id,
        plan_id: 0,
        subscriber: env.current_contract_address(),
        status: SubscriptionStatus::Active,
        started_at: 0,
        last_charged_at: 0,
        next_charge_at: 0,
        total_paid: 0,
        total_gas_spent: 0,
        charge_count: 0,
        paused_at: 0,
        pause_duration: 0,
        refund_requested_amount: 0,
    };

    let mut i = 0u32;
    while i < ids.len() {
        let event_id = ids.get_unchecked(i);
        if let Some(event) = event_store::read_event(env, event_id) {
            apply_event(&mut sub, &event, &mut subscriber_set);
        }
        i += 1;
    }

    Some(sub)
}

/// Reconstruct subscription state as it existed at a specific point in time.
pub(crate) fn reconstruct_state_at(
    env: &Env,
    subscription_id: u64,
    target_timestamp: u64,
) -> Option<Subscription> {
    let ids = event_store::read_event_ids(env, subscription_id);

    if ids.len() == 0 {
        return None;
    }

    let mut subscriber_set = false;
    let mut sub = Subscription {
        id: subscription_id,
        plan_id: 0,
        subscriber: env.current_contract_address(),
        status: SubscriptionStatus::Active,
        started_at: 0,
        last_charged_at: 0,
        next_charge_at: 0,
        total_paid: 0,
        total_gas_spent: 0,
        charge_count: 0,
        paused_at: 0,
        pause_duration: 0,
        refund_requested_amount: 0,
    };

    let mut i = 0u32;
    while i < ids.len() {
        let event_id = ids.get_unchecked(i);
        if let Some(event) = event_store::read_event(env, event_id) {
            if event.metadata.timestamp <= target_timestamp {
                apply_event(&mut sub, &event, &mut subscriber_set);
            } else {
                break;
            }
        }
        i += 1;
    }

    Some(sub)
}

/// Validate that a sequence of events represents a legal state machine
/// transition path for a subscription.
pub(crate) fn validate_event_sequence(
    events: Vec<StoredEvent>,
) -> Result<(), ContractError> {
    let mut current_status: Option<SubscriptionStatus> = None;

    let mut i = 0u32;
    while i < events.len() {
        let event = events.get_unchecked(i);
        let prior = event.prior_status;
        let new = event.new_status;

        if let Some(ref cur) = current_status {
            if *cur != prior {
                return Err(ContractError::InvalidEventSequence);
            }
        }

        if !is_valid_transition(&prior, &new) {
            return Err(ContractError::InvalidEventSequence);
        }

        current_status = Some(new);
        i += 1;
    }

    Ok(())
}

fn is_valid_transition(from: &SubscriptionStatus, to: &SubscriptionStatus) -> bool {
    match (from, to) {
        (SubscriptionStatus::Active, SubscriptionStatus::Paused) => true,
        (SubscriptionStatus::Active, SubscriptionStatus::Cancelled) => true,
        (SubscriptionStatus::Active, SubscriptionStatus::PastDue) => true,
        (SubscriptionStatus::Paused, SubscriptionStatus::Active) => true,
        (SubscriptionStatus::Paused, SubscriptionStatus::Cancelled) => true,
        (SubscriptionStatus::Cancelled, _) => false,
        (SubscriptionStatus::PastDue, SubscriptionStatus::Active) => true,
        (SubscriptionStatus::PastDue, SubscriptionStatus::Cancelled) => true,
        (SubscriptionStatus::PastDue, SubscriptionStatus::Paused) => true,
        _ => false,
    }
}

fn apply_event(
    sub: &mut Subscription,
    event: &StoredEvent,
    subscriber_set: &mut bool,
) {
    sub.status = event.new_status.clone();
    sub.plan_id = event.plan_id;

    if !*subscriber_set {
        sub.subscriber = event.metadata.actor.clone();
        *subscriber_set = true;
    }

    match event.event_type {
        SubscriptionEventType::Created => {
            sub.started_at = event.metadata.timestamp;
            sub.last_charged_at = event.metadata.timestamp;
        }
        SubscriptionEventType::Charged => {
            sub.total_paid = sub.total_paid.saturating_add(event.amount);
            sub.charge_count = sub.charge_count.saturating_add(1);
            sub.total_gas_spent = sub.total_gas_spent.saturating_add(100_000);
        }
        SubscriptionEventType::Paused => {
            sub.paused_at = event.metadata.timestamp;
        }
        SubscriptionEventType::Resumed => {
            let pause_elapsed = event.metadata.timestamp.saturating_sub(sub.paused_at);
            sub.pause_duration = sub.pause_duration.saturating_add(pause_elapsed);
            sub.paused_at = 0;
        }
        SubscriptionEventType::Cancelled => {}
        SubscriptionEventType::RefundRequested => {
            sub.refund_requested_amount = event.amount;
        }
        SubscriptionEventType::RefundApproved => {
            sub.refund_requested_amount = 0;
        }
        SubscriptionEventType::RefundRejected => {
            sub.refund_requested_amount = 0;
        }
        SubscriptionEventType::TransferAccepted => {
            sub.subscriber = event.metadata.actor.clone();
        }
        SubscriptionEventType::Upgraded | SubscriptionEventType::Downgraded => {
            sub.plan_id = event.plan_id;
        }
        SubscriptionEventType::TransferRequested
        | SubscriptionEventType::Updated
        | SubscriptionEventType::Renewed
        | SubscriptionEventType::PaymentFailed
        | SubscriptionEventType::PaymentTimedOut
        | SubscriptionEventType::PaymentRecoveryAttempted
        | SubscriptionEventType::PaymentRecoveryResolved
        | SubscriptionEventType::PaymentRecoveryAbandoned => {}
    }
}
