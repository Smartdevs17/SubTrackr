#![allow(dead_code)]
use soroban_sdk::{Env, Symbol};

pub enum OfferType {
    Discount,
    FreeGas,
    Extension,
}

pub fn _apply_retention_offer(_e: Env, _sub_id: Symbol, _offer_type: OfferType) {
    // Placeholder — full implementation requires subscription state access
    // through the storage contract bridge.  See issue #743.
}
