#![no_std]

extern crate alloc;

mod pdf;

use alloc::format;
use alloc::string::ToString;
use soroban_sdk::{Address, Bytes, Env, IntoVal, String, TryFromVal, Val, Vec};
use subtrackr_types::{
    Invoice, InvoiceConfig, InvoiceLineItem, InvoiceStatus, Interval, Plan, StorageKey,
    Subscription, TimeRange,
};

const DEFAULT_RATE_SCALE: i128 = 1_000_000;
const DEFAULT_PAYMENT_TERMS_SECS: u64 = 1_209_600; // 14 days
const DEFAULT_PREFIX: &str = "INV";
const DEFAULT_REGION: &str = "GLOBAL";

fn storage_instance_get<V: TryFromVal<Env, Val>>(env: &Env, key: StorageKey) -> Option<V> {
    env.storage().instance().get(&key)
}

fn storage_instance_set<V: IntoVal<Env, Val>>(env: &Env, key: StorageKey, value: V) {
    env.storage().instance().set(&key, &value);
}

fn storage_persistent_get<V: TryFromVal<Env, Val>>(env: &Env, key: StorageKey) -> Option<V> {
    env.storage().persistent().get(&key)
}

fn storage_persistent_set<V: IntoVal<Env, Val>>(env: &Env, key: StorageKey, value: V) {
    env.storage().persistent().set(&key, &value);
}

fn get_admin(env: &Env) -> Address {
    storage_instance_get(env, StorageKey::Admin).expect("Admin not set")
}

fn invoice_config(env: &Env) -> InvoiceConfig {
    storage_instance_get(env, StorageKey::InvoiceConfig).unwrap_or(InvoiceConfig {
        numbering_prefix: String::from_str(env, DEFAULT_PREFIX),
        numbering_padding: 6,
        default_currency: String::from_str(env, "USD"),
        default_tax_bps: 0,
        exchange_rate_scale: DEFAULT_RATE_SCALE,
        payment_terms_secs: DEFAULT_PAYMENT_TERMS_SECS,
    })
}

fn set_invoice_config(env: &Env, config: InvoiceConfig) {
    storage_instance_set(env, StorageKey::InvoiceConfig, config);
}

fn next_invoice_id(env: &Env) -> u64 {
    let current: u64 = storage_instance_get(env, StorageKey::InvoiceCount).unwrap_or(0);
    let next = current + 1;
    storage_instance_set(env, StorageKey::InvoiceCount, next);
    next
}

fn format_invoice_number(env: &Env, sequence: u64) -> String {
    let config = invoice_config(env);
    let prefix = config.numbering_prefix.to_string();
    let width = config.numbering_padding.max(1) as usize;
    let number = format!("{sequence:0width$}", width = width);
    String::from_str(env, &format!("{prefix}-{number}"))
}

fn get_subscription(env: &Env, storage: &Address, subscription_id: u64) -> Subscription {
    let args: Vec<Val> = soroban_sdk::vec![env, StorageKey::Subscription(subscription_id).into_val(env)];
    let val_opt: Option<Val> = env.invoke_contract(
        storage,
        &soroban_sdk::Symbol::new(env, "persistent_get"),
        args,
    );
    let val = val_opt.expect("Subscription not found");
    Subscription::try_from_val(env, &val).expect("Invalid subscription value")
}

fn get_plan(env: &Env, storage: &Address, plan_id: u64) -> Plan {
    let args: Vec<Val> = soroban_sdk::vec![env, StorageKey::Plan(plan_id).into_val(env)];
    let val_opt: Option<Val> = env.invoke_contract(
        storage,
        &soroban_sdk::Symbol::new(env, "persistent_get"),
        args,
    );
    let val = val_opt.expect("Plan not found");
    Plan::try_from_val(env, &val).expect("Invalid plan value")
}

fn get_tax_rate_bps(env: &Env, region: &String) -> u32 {
    storage_instance_get(env, StorageKey::TaxRate(region.clone()))
        .unwrap_or(invoice_config(env).default_tax_bps)
}

fn get_exchange_rate(env: &Env, currency: &String) -> i128 {
    if currency.is_empty() {
        return DEFAULT_RATE_SCALE;
    }
    storage_instance_get(env, StorageKey::ExchangeRate(currency.clone()))
        .unwrap_or(DEFAULT_RATE_SCALE)
}

fn convert_amount(amount: i128, exchange_rate: i128, scale: i128) -> i128 {
    if exchange_rate <= 0 || scale <= 0 {
        return amount;
    }
    amount.saturating_mul(exchange_rate) / scale
}

fn calculate_tax(subtotal: i128, tax_rate_bps: u32) -> i128 {
    subtotal.saturating_mul(tax_rate_bps as i128) / 10_000
}

fn build_line_item(
    env: &Env,
    plan: &Plan,
    invoice_currency: &String,
    tax_rate_bps: u32,
) -> InvoiceLineItem {
    let config = invoice_config(env);
    let exchange_rate = get_exchange_rate(env, invoice_currency);
    let unit_price = convert_amount(plan.price, exchange_rate, config.exchange_rate_scale);
    InvoiceLineItem {
        description: plan.name.clone(),
        quantity: 1,
        unit_price,
        currency: if invoice_currency.is_empty() {
            config.default_currency.clone()
        } else {
            invoice_currency.clone()
        },
        exchange_rate,
        tax_rate_bps,
        line_total: unit_price,
    }
}

fn store_invoice(env: &Env, invoice: &Invoice) {
    storage_persistent_set(env, StorageKey::Invoice(invoice.id), invoice.clone());
    let mut list: Vec<u64> = storage_instance_get(env, StorageKey::InvoiceBySubscription(invoice.subscription_id))
        .unwrap_or(Vec::new(env));
    list.push_back(invoice.id);
    storage_instance_set(
        env,
        StorageKey::InvoiceBySubscription(invoice.subscription_id),
        list,
    );
}

fn update_invoice_status(env: &Env, invoice_id: u64, status: InvoiceStatus) -> Invoice {
    let mut invoice: Invoice = storage_persistent_get(env, StorageKey::Invoice(invoice_id))
        .expect("Invoice not found");
    invoice.status = status;
    storage_persistent_set(env, StorageKey::Invoice(invoice_id), invoice.clone());
    invoice
}

#[soroban_sdk::contract]
pub struct SubTrackrInvoice;

#[soroban_sdk::contractimpl]
impl SubTrackrInvoice {
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        if storage_instance_get::<Address>(&env, StorageKey::Admin).is_some() {
            panic!("Already initialized");
        }
        storage_instance_set(&env, StorageKey::Admin, admin);
        storage_instance_set(&env, StorageKey::InvoiceCount, 0u64);
        set_invoice_config(
            &env,
            InvoiceConfig {
                numbering_prefix: String::from_str(&env, DEFAULT_PREFIX),
                numbering_padding: 6,
                default_currency: String::from_str(&env, "USD"),
                default_tax_bps: 0,
                exchange_rate_scale: DEFAULT_RATE_SCALE,
                payment_terms_secs: DEFAULT_PAYMENT_TERMS_SECS,
            },
        );
    }

    pub fn set_config(env: Env, admin: Address, config: InvoiceConfig) {
        get_admin(&env).require_auth();
        assert!(admin == get_admin(&env), "Admin mismatch");
        admin.require_auth();
        set_invoice_config(&env, config);
    }

    pub fn set_tax_rate(env: Env, admin: Address, region: String, tax_rate_bps: u32) {
        let stored_admin = get_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();
        storage_instance_set(&env, StorageKey::TaxRate(region), tax_rate_bps);
    }

    pub fn set_exchange_rate(env: Env, admin: Address, currency: String, exchange_rate: i128) {
        let stored_admin = get_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();
        storage_instance_set(&env, StorageKey::ExchangeRate(currency), exchange_rate);
    }

    pub fn generate_invoice(
        env: Env,
        storage: Address,
        subscription_id: u64,
        period: TimeRange,
        region: String,
        currency: String,
    ) -> Invoice {
        let subscription = get_subscription(&env, &storage, subscription_id);
        let plan = get_plan(&env, &storage, subscription.plan_id);
        let config = invoice_config(&env);
        let effective_currency = if currency.is_empty() {
            config.default_currency.clone()
        } else {
            currency.clone()
        };
        let effective_region = if region.is_empty() {
            String::from_str(&env, DEFAULT_REGION)
        } else {
            region.clone()
        };
        let tax_rate_bps = get_tax_rate_bps(&env, &effective_region);
        let line_item = build_line_item(&env, &plan, &effective_currency, tax_rate_bps);
        let subtotal = line_item.line_total;
        let tax = calculate_tax(subtotal, tax_rate_bps);
        let total = subtotal + tax;
        let id = next_invoice_id(&env);
        let invoice = Invoice {
            id,
            invoice_number: format_invoice_number(&env, id),
            subscription_id,
            subscriber: subscription.subscriber.clone(),
            merchant: plan.merchant.clone(),
            period,
            line_items: soroban_sdk::vec![&env, line_item],
            subtotal,
            tax,
            total,
            due_date: subscription.next_charge_at + config.payment_terms_secs,
            status: InvoiceStatus::Draft,
            currency: effective_currency,
            region: effective_region,
        };
        store_invoice(&env, &invoice);
        invoice
    }

    pub fn get_invoice(env: Env, invoice_id: u64) -> Invoice {
        storage_persistent_get(&env, StorageKey::Invoice(invoice_id)).expect("Invoice not found")
    }

    pub fn get_invoice_ids(env: Env, subscription_id: u64) -> Vec<u64> {
        storage_instance_get(&env, StorageKey::InvoiceBySubscription(subscription_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn void_invoice(env: Env, admin: Address, invoice_id: u64) -> Invoice {
        let stored_admin = get_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();
        update_invoice_status(&env, invoice_id, InvoiceStatus::Void)
    }

    pub fn send_invoice(env: Env, admin: Address, invoice_id: u64) -> Invoice {
        let stored_admin = get_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();
        update_invoice_status(&env, invoice_id, InvoiceStatus::Sent)
    }

    pub fn mark_paid(env: Env, admin: Address, invoice_id: u64) -> Invoice {
        let stored_admin = get_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();
        update_invoice_status(&env, invoice_id, InvoiceStatus::Paid)
    }

    pub fn get_pdf(env: Env, invoice_id: u64) -> Bytes {
        let invoice = Self::get_invoice(env.clone(), invoice_id);
        pdf::render_pdf(&env, &invoice)
    }

    pub fn get_config(env: Env) -> InvoiceConfig {
        invoice_config(&env)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use subtrackr_storage::{SubTrackrStorage, SubTrackrStorageClient};

    fn setup_env() -> (Env, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().set_timestamp(1_750_000_000);

        let admin = Address::generate(&env);
        let storage_id = env.register_contract(None, SubTrackrStorage);
        let invoice_id = env.register_contract(None, SubTrackrInvoice);
        let storage_client = SubTrackrStorageClient::new(&env, &storage_id);
        storage_client.initialize(&admin, &invoice_id);

        (env, admin, storage_id, invoice_id)
    }

    #[test]
    fn generates_invoice_with_tax_and_numbering() {
        let (env, admin, storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let plan = Plan {
            id: 1,
            merchant: merchant.clone(),
            name: String::from_str(&env, "Pro Plan"),
            price: 10_000,
            token: merchant.clone(),
            interval: Interval::Monthly,
            active: true,
            subscriber_count: 1,
            created_at: 1_750_000_000,
        };
        let subscription = Subscription {
            id: 1,
            plan_id: 1,
            subscriber: subscriber.clone(),
            status: subtrackr_types::SubscriptionStatus::Active,
            started_at: 1_750_000_000,
            last_charged_at: 1_750_000_000,
            next_charge_at: 1_750_000_000 + 2_592_000,
            total_paid: 0,
            total_gas_spent: 0,
            charge_count: 0,
            paused_at: 0,
            pause_duration: 0,
            refund_requested_amount: 0,
        };
        let storage_client = SubTrackrStorageClient::new(&env, &storage);
        storage_client.persistent_set(&StorageKey::Plan(1), &plan.into_val(&env));
        storage_client.persistent_set(&StorageKey::Subscription(1), &subscription.into_val(&env));
        contract.set_tax_rate(&admin, &String::from_str(&env, "GLOBAL"), &500);

        let invoice = contract.generate_invoice(
            &storage,
            &1u64,
            &TimeRange {
                start: 1_750_000_000,
                end: 1_750_000_000 + 2_592_000,
            },
            &String::from_str(&env, "GLOBAL"),
            &String::from_str(&env, "USD"),
        );

        assert_eq!(invoice.invoice_number.to_string(), "INV-000001");
        assert_eq!(invoice.subtotal, 10_000);
        assert_eq!(invoice.tax, 500);
        assert_eq!(invoice.total, 10_500);
        assert_eq!(invoice.status, InvoiceStatus::Draft);
    }

    #[test]
    fn pdf_contains_invoice_summary() {
        let (env, admin, storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let plan = Plan {
            id: 1,
            merchant,
            name: String::from_str(&env, "Pro Plan"),
            price: 10_000,
            token: Address::generate(&env),
            interval: Interval::Monthly,
            active: true,
            subscriber_count: 1,
            created_at: 1_750_000_000,
        };
        let subscription = Subscription {
            id: 1,
            plan_id: 1,
            subscriber,
            status: subtrackr_types::SubscriptionStatus::Active,
            started_at: 1_750_000_000,
            last_charged_at: 1_750_000_000,
            next_charge_at: 1_750_000_000 + 2_592_000,
            total_paid: 0,
            total_gas_spent: 0,
            charge_count: 0,
            paused_at: 0,
            pause_duration: 0,
            refund_requested_amount: 0,
        };
        let storage_client = SubTrackrStorageClient::new(&env, &storage);
        storage_client.persistent_set(&StorageKey::Plan(1), &plan.into_val(&env));
        storage_client.persistent_set(&StorageKey::Subscription(1), &subscription.into_val(&env));

        let invoice = contract.generate_invoice(
            &storage,
            &1u64,
            &TimeRange {
                start: 1_750_000_000,
                end: 1_750_000_000 + 2_592_000,
            },
            &String::from_str(&env, "GLOBAL"),
            &String::from_str(&env, "USD"),
        );

        let pdf = contract.get_pdf(&invoice.id);
        let mut rendered_bytes = vec![0u8; pdf.len() as usize];
        pdf.copy_into_slice(&mut rendered_bytes);
        let rendered = core::str::from_utf8(rendered_bytes.as_slice()).unwrap();
        assert!(rendered.contains("SubTrackr Invoice"));
        assert!(rendered.contains("INV-000001"));
        assert!(rendered.contains("Pro Plan"));
        assert!(rendered.contains("%PDF-1.4"));
    }
}
