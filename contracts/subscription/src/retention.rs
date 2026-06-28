pub enum OfferType {
    Discount,
    FreeGas,
    Extension,
}

pub fn apply_retention_offer(e: Env, sub_id: Symbol, offer_type: OfferType) {
    let mut sub: Subscription = e.storage().instance().get(&sub_id).unwrap();
    
    match offer_type {
        OfferType::Discount => {
            sub.price = sub.price * 80 / 100; // 20% Retention Discount
        },
        OfferType::FreeGas => {
            sub.gas_budget += 0.50; // Add bonus XLM for gas
        },
        OfferType::Extension => {
            sub.next_billing_date += 2592000; // 30 days free
        }
    }
    
    sub.status = Status::Active;
    e.storage().instance().set(&sub_id, &sub);
}