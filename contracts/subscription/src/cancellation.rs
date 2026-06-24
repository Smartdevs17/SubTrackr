use soroban_sdk::{Env, Address, Symbol, log};
use crate::storage_types::{Subscription, Status};

pub fn request_cancellation(e: Env, sub_id: Symbol) {
    let mut sub: Subscription = e.storage().instance().get(&sub_id).unwrap();
    
    // Instead of immediate deletion, we set an end date
    // to allow the user to enjoy the remaining paid period.
    let current_ts = e.ledger().timestamp();
    sub.status = Status::ScheduledForCancellation;
    sub.end_date = Some(sub.next_billing_date); 
    sub.updated_at = current_ts;

    e.storage().instance().set(&sub_id, &sub);
    log!(&e, "Subscription scheduled for cancellation", sub_id);
}

pub fn undo_cancellation(e: Env, sub_id: Symbol) {
    let mut sub: Subscription = e.storage().instance().get(&sub_id).unwrap();
    sub.status = Status::Active;
    sub.end_date = None;
    
    e.storage().instance().set(&sub_id, &sub);
}