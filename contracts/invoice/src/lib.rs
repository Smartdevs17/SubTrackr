#![no_std]

extern crate alloc;

mod pdf;

use alloc::format;
use alloc::string::ToString;
use alloc::vec;
use soroban_sdk::{Address, Bytes, Env, IntoVal, String, TryFromVal, Val, Vec};
use subtrackr_types::{
    CustomerTaxStatus, DigitalGoodsClass, Invoice, InvoiceConfig, InvoiceLineItem, InvoiceStatus,
    Plan, StorageKey, Subscription, TaxRateChangeEvent, TaxRateEntry, TaxRemittanceLineItem,
    TaxRemittanceReport, TaxType, TaxJurisdiction, TimeRange, TaxReportLineItem, RemittanceStatus,
};

const DEFAULT_RATE_SCALE: i128 = 1_000_000;
const DEFAULT_PAYMENT_TERMS_SECS: u64 = 1_209_600;
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
    String::from_str(env, &format!("{prefix}-{number:0width$}", width = width))
}

fn get_subscription(env: &Env, storage: &Address, subscription_id: u64) -> Subscription {
    let args: Vec<Val> =
        soroban_sdk::vec![env, StorageKey::Subscription(subscription_id).into_val(env)];
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

fn build_jurisdiction_key(country: &str, state: &str, city: &str) -> String {
    if !city.is_empty() {
        format!("{country}-{state}-{city}", country = country, state = state, city = city)
    } else if !state.is_empty() {
        format!("{country}-{state}", country = country, state = state)
    } else {
        country.to_string()
    }
}

fn resolve_tax_rate_entry(env: &Env, country: &String, state: &String, city: &String) -> TaxRateEntry {
    let mut lookup_keys = Vec::new(env);

    if !city.is_empty() && !state.is_empty() && !country.is_empty() {
        lookup_keys.push_back(String::from_str(
            env,
            &format!(
                "{}-{}-{}",
                country.to_string(),
                state.to_string(),
                city.to_string()
            ),
        ));
    }
    if !state.is_empty() && !country.is_empty() {
        lookup_keys.push_back(String::from_str(
            env,
            &format!("{}-{}", country.to_string(), state.to_string()),
        ));
    }
    if !country.is_empty() {
        lookup_keys.push_back(country.clone());
    }
    lookup_keys.push_back(String::from_str(env, "GLOBAL"));

    for key in lookup_keys.iter() {
        let entry: Option<TaxRateEntry> =
            storage_persistent_get(env, StorageKey::TaxRateEntry(key.clone()));
        if let Some(e) = entry {
            return e;
        }
    }

    TaxRateEntry {
        jurisdiction_key: String::from_str(env, "GLOBAL"),
        tax_type: TaxType::None,
        rate_bps: invoice_config(env).default_tax_bps,
        display_name: String::from_str(env, "Default"),
        effective_from: 0,
        effective_until: 0,
        applies_to_digital_goods: false,
        reverse_charge: false,
        nexus_threshold: 0,
    }
}

fn get_customer_tax_status(env: &Env, subscriber: &Address) -> CustomerTaxStatus {
    storage_persistent_get(env, StorageKey::CustomerTaxStatus(subscriber.clone()))
        .unwrap_or(CustomerTaxStatus {
            is_exempt: false,
            certificate_id: String::from_str(env, ""),
            certificate_expiry: 0,
            issuing_authority: String::from_str(env, ""),
            exempt_jurisdictions: Vec::new(env),
            digital_goods_override: None,
        })
}

fn is_customer_tax_exempt(env: &Env, subscriber: &Address, jurisdiction_key: &String) -> bool {
    let status = get_customer_tax_status(env, subscriber);
    if !status.is_exempt {
        return false;
    }
    let now = env.ledger().timestamp();
    if status.certificate_expiry > 0 && now > status.certificate_expiry {
        return false;
    }
    if status.exempt_jurisdictions.is_empty() {
        return true;
    }
    for j in status.exempt_jurisdictions.iter() {
        if j == jurisdiction_key {
            return true;
        }
    }
    false
}

fn get_digital_goods_class(env: &Env, plan_id: u64) -> DigitalGoodsClass {
    storage_persistent_get(env, StorageKey::DigitalGoodsClass(plan_id))
        .unwrap_or(DigitalGoodsClass::ElectronicService)
}

fn log_tax_rate_change(
    env: &Env,
    jurisdiction_key: &String,
    old_rate_bps: u32,
    new_rate_bps: u32,
    effective_from: u64,
) {
    let mut log: Vec<TaxRateChangeEvent> = storage_persistent_get(
        env,
        StorageKey::TaxRateChangeLogByJdx(jurisdiction_key.clone()),
    )
    .unwrap_or(Vec::new(env));

    let jurisdiction = TaxJurisdiction {
        country: jurisdiction_key.clone(),
        state: String::from_str(env, ""),
        city: String::from_str(env, ""),
        postal_code: String::from_str(env, ""),
        tax_type: TaxType::None,
        rate_bps: new_rate_bps,
        label: String::from_str(env, ""),
        effective_date: effective_from,
    };

    log.push_back(TaxRateChangeEvent {
        jurisdiction,
        old_rate_bps,
        new_rate_bps,
        effective_date: effective_from,
    });

    storage_persistent_set(
        env,
        StorageKey::TaxRateChangeLogByJdx(jurisdiction_key.clone()),
        log,
    );
}

fn calculate_mid_cycle_tax(
    env: &Env,
    subtotal: i128,
    jurisdiction_key: &String,
    period: &TimeRange,
) -> i128 {
    let log: Vec<TaxRateChangeEvent> = storage_persistent_get(
        env,
        StorageKey::TaxRateChangeLogByJdx(jurisdiction_key.clone()),
    )
    .unwrap_or(Vec::new(env));

    if log.is_empty() {
        let rate = get_tax_rate_bps(env, jurisdiction_key);
        return calculate_tax(subtotal, rate);
    }

    let period_duration = period.end.saturating_sub(period.start);
    if period_duration == 0 {
        let rate = get_tax_rate_bps(env, jurisdiction_key);
        return calculate_tax(subtotal, rate);
    }

    let mut tax_total: i128 = 0;
    let mut current_start = period.start;

    for event in log.iter() {
        if event.effective_date <= period.start || event.effective_date >= period.end {
            continue;
        }
        let segment_end = event.effective_date;
        let segment_duration = segment_end.saturating_sub(current_start);
        if segment_duration > 0 && period_duration > 0 {
            let segment_ratio = (segment_duration as i128) * 10_000 / (period_duration as i128);
            let segment_subtotal = (subtotal * segment_ratio) / 10_000;
            tax_total += calculate_tax(segment_subtotal, event.old_rate_bps);
        }
        current_start = segment_end;
    }

    let remaining_duration = period.end.saturating_sub(current_start);
    if remaining_duration > 0 && period_duration > 0 {
        let remaining_ratio = (remaining_duration as i128) * 10_000 / (period_duration as i128);
        let remaining_subtotal = (subtotal * remaining_ratio) / 10_000;
        let final_rate = get_tax_rate_bps(env, jurisdiction_key);
        tax_total += calculate_tax(remaining_subtotal, final_rate);
    }

    tax_total
}

fn store_tax_remittance_line(
    env: &Env,
    invoice: &Invoice,
    jurisdiction_key: &String,
    tax_type: &TaxType,
) {
    let key = StorageKey::TaxRemittanceLine(invoice.id, jurisdiction_key.clone());
    let rate_bps = if invoice.subtotal > 0 {
        ((invoice.tax * 10_000) / invoice.subtotal) as u32
    } else {
        0
    };
    storage_persistent_set(
        env,
        key,
        TaxRemittanceLineItem {
            jurisdiction_key: jurisdiction_key.clone(),
            tax_type: tax_type.clone(),
            taxable_amount: invoice.subtotal,
            rate_bps,
            tax_collected: invoice.tax,
            transaction_count: 1,
            currency: invoice.currency.clone(),
        },
    );
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
    let mut list: Vec<u64> = storage_instance_get(
        env,
        StorageKey::InvoiceBySubscription(invoice.subscription_id),
    )
    .unwrap_or(Vec::new(env));
    list.push_back(invoice.id);
    storage_instance_set(
        env,
        StorageKey::InvoiceBySubscription(invoice.subscription_id),
        list,
    );
}

fn update_invoice_status(env: &Env, invoice_id: u64, status: InvoiceStatus) -> Invoice {
    let mut invoice: Invoice =
        storage_persistent_get(env, StorageKey::Invoice(invoice_id)).expect("Invoice not found");
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
        country: String,
        state: String,
        city: String,
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

        let jurisdiction_key_str = build_jurisdiction_key(
            &country.to_string(),
            &state.to_string(),
            &city.to_string(),
        );
        let jurisdiction_key = String::from_str(&env, &jurisdiction_key_str);

        let is_exempt = is_customer_tax_exempt(&env, &subscription.subscriber, &jurisdiction_key);

        let entry = resolve_tax_rate_entry(&env, &country, &state, &city);

        let (tax_rate_bps, tax_type, reverse_charge) = if is_exempt {
            (0u32, TaxType::None, false)
        } else {
            (entry.rate_bps, entry.tax_type.clone(), entry.reverse_charge)
        };

        let line_item = build_line_item(&env, &plan, &effective_currency, tax_rate_bps);
        let subtotal = line_item.line_total;

        let tax = if tax_rate_bps == 0 || is_exempt {
            0i128
        } else {
            calculate_mid_cycle_tax(&env, subtotal, &jurisdiction_key, &period)
        };

        let total = subtotal + tax;
        let id = next_invoice_id(&env);

        let display_region = if reverse_charge {
            String::from_str(&env, &format!("{}-RC", &jurisdiction_key_str))
        } else {
            jurisdiction_key.clone()
        };

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
            region: display_region,
        };
        store_invoice(&env, &invoice);
        store_tax_remittance_line(&env, &invoice, &jurisdiction_key, &tax_type);
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

    // ── Tax Jurisdiction Management ──

    pub fn set_tax_jurisdiction(
        env: Env,
        admin: Address,
        country: String,
        state: String,
        city: String,
        tax_type: TaxType,
        rate_bps: u32,
        display_name: String,
        effective_from: u64,
        effective_until: u64,
        applies_to_digital_goods: bool,
        reverse_charge: bool,
        nexus_threshold: i128,
    ) {
        let stored_admin = get_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();

        let jurisdiction_key_str = build_jurisdiction_key(
            &country.to_string(),
            &state.to_string(),
            &city.to_string(),
        );
        let key = String::from_str(&env, &jurisdiction_key_str);

        let old_rate_bps = storage_persistent_get::<TaxRateEntry>(
            &env,
            StorageKey::TaxRateEntry(key.clone()),
        )
        .map(|e| e.rate_bps)
        .unwrap_or(0);

        let entry = TaxRateEntry {
            jurisdiction_key: key.clone(),
            tax_type,
            rate_bps,
            display_name,
            effective_from,
            effective_until,
            applies_to_digital_goods,
            reverse_charge,
            nexus_threshold,
        };

        storage_persistent_set(&env, StorageKey::TaxRateEntry(key.clone()), entry);

        if old_rate_bps != rate_bps {
            log_tax_rate_change(&env, &key, old_rate_bps, rate_bps, effective_from);
        }
    }

    pub fn get_tax_rate(
        env: Env,
        country: String,
        state: String,
        city: String,
    ) -> TaxRateEntry {
        resolve_tax_rate_entry(&env, &country, &state, &city)
    }

    // ── Tax-Exempt Customer Management ──

    pub fn set_customer_tax_status(
        env: Env,
        admin: Address,
        subscriber: Address,
        is_exempt: bool,
        certificate_id: String,
        certificate_expiry: u64,
        issuing_authority: String,
        exempt_jurisdictions: Vec<String>,
        digital_goods_override: Option<DigitalGoodsClass>,
    ) {
        let stored_admin = get_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();

        let now = env.ledger().timestamp();
        assert!(
            certificate_expiry == 0 || certificate_expiry > now,
            "Certificate already expired"
        );

        let status = CustomerTaxStatus {
            is_exempt,
            certificate_id,
            certificate_expiry,
            issuing_authority,
            exempt_jurisdictions,
            digital_goods_override,
        };

        storage_persistent_set(
            &env,
            StorageKey::CustomerTaxStatus(subscriber.clone()),
            status,
        );

        env.events().publish(
            (
                String::from_str(&env, "tax_status_updated"),
                subscriber.clone(),
            ),
            is_exempt,
        );
    }

    pub fn get_customer_tax_status_query(env: Env, subscriber: Address) -> CustomerTaxStatus {
        get_customer_tax_status(&env, &subscriber)
    }

    pub fn check_tax_exemption(
        env: Env,
        subscriber: Address,
        jurisdiction_key: String,
    ) -> bool {
        is_customer_tax_exempt(&env, &subscriber, &jurisdiction_key)
    }

    pub fn validate_tax_certificate(
        env: Env,
        subscriber: Address,
        certificate_id: String,
    ) -> bool {
        let status = get_customer_tax_status(&env, &subscriber);
        if !status.is_exempt {
            return false;
        }
        if status.certificate_id.to_string() != certificate_id.to_string() {
            return false;
        }
        let now = env.ledger().timestamp();
        if status.certificate_expiry > 0 && now > status.certificate_expiry {
            return false;
        }
        true
    }

    // ── Digital Goods Classification ──

    pub fn set_digital_goods_class(
        env: Env,
        admin: Address,
        plan_id: u64,
        goods_class: DigitalGoodsClass,
    ) {
        let stored_admin = get_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();
        storage_persistent_set(&env, StorageKey::DigitalGoodsClass(plan_id), goods_class);
    }

    pub fn get_digital_goods_class_query(env: Env, plan_id: u64) -> DigitalGoodsClass {
        get_digital_goods_class(&env, plan_id)
    }

    // ── Nexus Determination ──

    pub fn check_nexus(
        env: Env,
        merchant: Address,
        country: String,
        state: String,
        city: String,
    ) -> bool {
        let jurisdiction_key_str = build_jurisdiction_key(
            &country.to_string(),
            &state.to_string(),
            &city.to_string(),
        );
        let key = String::from_str(&env, &jurisdiction_key_str);
        let entry: Option<TaxRateEntry> =
            storage_persistent_get(&env, StorageKey::TaxRateEntry(key.clone()));
        if entry.is_none() {
            return false;
        }
        let threshold = entry.unwrap().nexus_threshold;
        threshold == 0
    }

    // ── Tax Remittance Report Generation ──

    pub fn generate_tax_remittance_report(
        env: Env,
        admin: Address,
        merchant: Address,
        period_start: u64,
        period_end: u64,
    ) -> TaxRemittanceReport {
        let stored_admin = get_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();

        let mut counter: u64 =
            storage_instance_get(&env, StorageKey::TaxRemittanceReportCount).unwrap_or(0);
        counter += 1;
        storage_instance_set(&env, StorageKey::TaxRemittanceReportCount, counter);

        let invoice_count: u64 =
            storage_instance_get(&env, StorageKey::InvoiceCount).unwrap_or(0);

        let mut total_tax: i128 = 0;
        let mut total_taxable: i128 = 0;
        let mut tx_count: u32 = 0;
        let mut report_lines: Vec<TaxReportLineItem> = Vec::new(&env);

        let mut i: u64 = 1;
        while i <= invoice_count {
            let invoice: Option<Invoice> =
                storage_persistent_get(&env, StorageKey::Invoice(i));
            if let Some(inv) = invoice {
                if inv.merchant == merchant
                    && inv.due_date >= period_start
                    && inv.due_date <= period_end
                {
                    total_tax += inv.tax;
                    total_taxable += inv.subtotal;
                    tx_count += 1;

                    report_lines.push_back(TaxReportLineItem {
                        invoice_id: inv.id,
                        invoice_number: inv.invoice_number.clone(),
                        subscription_id: inv.subscription_id,
                        customer: inv.subscriber.clone(),
                        taxable_amount: inv.subtotal,
                        tax_rate_bps: if inv.subtotal > 0 {
                            ((inv.tax * 10_000) / inv.subtotal) as u32
                        } else {
                            0
                        },
                        tax_amount: inv.tax,
                        digital_goods_category: subtrackr_types::DigitalGoodsCategory::Saas,
                        invoice_date: inv.due_date,
                    });
                }
            }
            i += 1;
        }

        let jurisdiction = TaxJurisdiction {
            country: String::from_str(&env, ""),
            state: String::from_str(&env, ""),
            city: String::from_str(&env, ""),
            postal_code: String::from_str(&env, ""),
            tax_type: TaxType::None,
            rate_bps: 0,
            label: String::from_str(&env, "Multi-jurisdiction"),
            effective_date: 0,
        };

        let report = TaxRemittanceReport {
            id: counter,
            period: TimeRange {
                start: period_start,
                end: period_end,
            },
            jurisdiction,
            merchant: merchant.clone(),
            total_taxable_amount: total_taxable,
            total_tax_collected: total_tax,
            total_tax_remitted: 0,
            transaction_count: tx_count,
            line_items: report_lines,
            generated_at: env.ledger().timestamp(),
            submitted_at: 0,
            status: RemittanceStatus::Draft,
            notes: String::from_str(&env, ""),
        };

        storage_persistent_set(
            &env,
            StorageKey::TaxRemittanceReport(counter),
            report.clone(),
        );

        report
    }

    pub fn get_tax_remittance_report(env: Env, report_id: u64) -> TaxRemittanceReport {
        storage_persistent_get(&env, StorageKey::TaxRemittanceReport(report_id))
            .expect("Tax remittance report not found")
    }

    pub fn get_tax_rate_change_log(
        env: Env,
        jurisdiction_key: String,
    ) -> Vec<TaxRateChangeEvent> {
        storage_persistent_get(
            &env,
            StorageKey::TaxRateChangeLogByJdx(jurisdiction_key),
        )
        .unwrap_or(Vec::new(&env))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use subtrackr_storage::{SubTrackrStorage, SubTrackrStorageClient};
    use subtrackr_types::Interval;

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

    fn setup_subscription(
        env: &Env,
        storage: &Address,
        merchant: &Address,
        subscriber: &Address,
    ) {
        let plan = Plan {
            id: 1,
            merchant: merchant.clone(),
            name: String::from_str(env, "Pro Plan"),
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
        let storage_client = SubTrackrStorageClient::new(env, storage);
        storage_client.persistent_set(&StorageKey::Plan(1), &plan.into_val(env));
        storage_client.persistent_set(&StorageKey::Subscription(1), &subscription.into_val(env));
    }

    fn str_empty(env: &Env) -> String {
        String::from_str(env, "")
    }

    #[test]
    fn generates_invoice_with_tax_and_numbering() {
        let (env, admin, storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);
        setup_subscription(&env, &storage, &merchant, &subscriber);

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
            &str_empty(&env),
            &str_empty(&env),
            &str_empty(&env),
        );

        assert_eq!(invoice.invoice_number.to_string(), "INV-000001");
        assert_eq!(invoice.subtotal, 10_000);
        assert_eq!(invoice.total, 10_500);
        assert_eq!(invoice.status, InvoiceStatus::Draft);
    }

    #[test]
    fn generates_invoice_with_multi_jurisdiction_tax() {
        let (env, admin, storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);
        setup_subscription(&env, &storage, &merchant, &subscriber);

        contract.set_tax_jurisdiction(
            &admin,
            &String::from_str(&env, "US"),
            &String::from_str(&env, "CA"),
            &String::from_str(&env, "SF"),
            &TaxType::SalesTax,
            &850,
            &String::from_str(&env, "CA Sales Tax"),
            &0u64,
            &0u64,
            &true,
            &false,
            &0i128,
        );

        let invoice = contract.generate_invoice(
            &storage,
            &1u64,
            &TimeRange {
                start: 1_750_000_000,
                end: 1_750_000_000 + 2_592_000,
            },
            &str_empty(&env),
            &String::from_str(&env, "USD"),
            &String::from_str(&env, "US"),
            &String::from_str(&env, "CA"),
            &String::from_str(&env, "SF"),
        );

        assert_eq!(invoice.tax, 850);
        assert_eq!(invoice.total, 10_850);
    }

    #[test]
    fn tax_exempt_customer_zero_tax() {
        let (env, admin, storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);
        setup_subscription(&env, &storage, &merchant, &subscriber);

        contract.set_tax_jurisdiction(
            &admin,
            &String::from_str(&env, "US"),
            &String::from_str(&env, "CA"),
            &str_empty(&env),
            &TaxType::SalesTax,
            &850,
            &String::from_str(&env, "CA Sales Tax"),
            &0u64,
            &0u64,
            &true,
            &false,
            &0i128,
        );

        contract.set_customer_tax_status(
            &admin,
            &subscriber,
            &true,
            &String::from_str(&env, "CERT-001"),
            &0u64,
            &String::from_str(&env, "CA Tax Authority"),
            &Vec::new(&env),
            &None,
        );

        let invoice = contract.generate_invoice(
            &storage,
            &1u64,
            &TimeRange {
                start: 1_750_000_000,
                end: 1_750_000_000 + 2_592_000,
            },
            &str_empty(&env),
            &String::from_str(&env, "USD"),
            &String::from_str(&env, "US"),
            &String::from_str(&env, "CA"),
            &str_empty(&env),
        );

        assert_eq!(invoice.tax, 0);
        assert_eq!(invoice.total, 10_000);
    }

    #[test]
    fn tax_exempt_with_expired_certificate_charges_tax() {
        let (env, admin, storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);
        setup_subscription(&env, &storage, &merchant, &subscriber);

        contract.set_tax_jurisdiction(
            &admin,
            &String::from_str(&env, "UK"),
            &str_empty(&env),
            &str_empty(&env),
            &TaxType::Vat,
            &2000,
            &String::from_str(&env, "UK VAT"),
            &0u64,
            &0u64,
            &true,
            &false,
            &0i128,
        );

        contract.set_customer_tax_status(
            &admin,
            &subscriber,
            &true,
            &String::from_str(&env, "CERT-EXPIRED"),
            &1_000_000_000u64,
            &String::from_str(&env, "UK HMRC"),
            &Vec::new(&env),
            &None,
        );

        let invoice = contract.generate_invoice(
            &storage,
            &1u64,
            &TimeRange {
                start: 1_750_000_000,
                end: 1_750_000_000 + 2_592_000,
            },
            &str_empty(&env),
            &String::from_str(&env, "GBP"),
            &String::from_str(&env, "UK"),
            &str_empty(&env),
            &str_empty(&env),
        );

        assert_eq!(invoice.tax, 2000);
    }

    #[test]
    fn jurisdiction_fallback() {
        let (env, admin, storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);
        setup_subscription(&env, &storage, &merchant, &subscriber);

        contract.set_tax_jurisdiction(
            &admin,
            &String::from_str(&env, "DE"),
            &str_empty(&env),
            &str_empty(&env),
            &TaxType::Vat,
            &1900,
            &String::from_str(&env, "German VAT"),
            &0u64,
            &0u64,
            &true,
            &false,
            &0i128,
        );

        let invoice = contract.generate_invoice(
            &storage,
            &1u64,
            &TimeRange {
                start: 1_750_000_000,
                end: 1_750_000_000 + 2_592_000,
            },
            &str_empty(&env),
            &String::from_str(&env, "EUR"),
            &String::from_str(&env, "DE"),
            &str_empty(&env),
            &str_empty(&env),
        );

        assert_eq!(invoice.tax, 1900);
    }

    #[test]
    fn reverse_charge_suffix() {
        let (env, admin, storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);
        setup_subscription(&env, &storage, &merchant, &subscriber);

        contract.set_tax_jurisdiction(
            &admin,
            &String::from_str(&env, "IE"),
            &str_empty(&env),
            &str_empty(&env),
            &TaxType::Vat,
            &0,
            &String::from_str(&env, "Ireland VAT RC"),
            &0u64,
            &0u64,
            &true,
            &true,
            &0i128,
        );

        let invoice = contract.generate_invoice(
            &storage,
            &1u64,
            &TimeRange {
                start: 1_750_000_000,
                end: 1_750_000_000 + 2_592_000,
            },
            &str_empty(&env),
            &String::from_str(&env, "EUR"),
            &String::from_str(&env, "IE"),
            &str_empty(&env),
            &str_empty(&env),
        );

        assert!(invoice.region.to_string().contains("RC"));
    }

    #[test]
    fn tax_remittance_report() {
        let (env, admin, storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);
        setup_subscription(&env, &storage, &merchant, &subscriber);

        contract.set_tax_jurisdiction(
            &admin,
            &String::from_str(&env, "US"),
            &str_empty(&env),
            &str_empty(&env),
            &TaxType::SalesTax,
            &800,
            &String::from_str(&env, "US Tax"),
            &0u64,
            &0u64,
            &true,
            &false,
            &0i128,
        );

        let _invoice = contract.generate_invoice(
            &storage,
            &1u64,
            &TimeRange {
                start: 1_750_000_000,
                end: 1_750_000_000 + 2_592_000,
            },
            &str_empty(&env),
            &String::from_str(&env, "USD"),
            &String::from_str(&env, "US"),
            &str_empty(&env),
            &str_empty(&env),
        );

        let report = contract.generate_tax_remittance_report(
            &admin,
            &merchant,
            &1_749_000_000u64,
            &1_760_000_000u64,
        );

        assert_eq!(report.total_tax_collected, 800);
        assert_eq!(report.transaction_count, 1);
    }

    #[test]
    fn validate_certificate() {
        let (env, admin, _storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        let subscriber = Address::generate(&env);
        contract.set_customer_tax_status(
            &admin,
            &subscriber,
            &true,
            &String::from_str(&env, "CERT-VALID"),
            &0u64,
            &String::from_str(&env, "Authority"),
            &Vec::new(&env),
            &None,
        );

        assert!(contract.validate_tax_certificate(&subscriber, &String::from_str(&env, "CERT-VALID")));
        assert!(!contract.validate_tax_certificate(&subscriber, &String::from_str(&env, "CERT-FAKE")));
    }

    #[test]
    fn tax_rate_change_log() {
        let (env, admin, _storage, invoice_contract) = setup_env();
        let contract = SubTrackrInvoiceClient::new(&env, &invoice_contract);
        contract.initialize(&admin);

        contract.set_tax_jurisdiction(
            &admin,
            &String::from_str(&env, "CA"),
            &str_empty(&env),
            &str_empty(&env),
            &TaxType::Gst,
            &500,
            &String::from_str(&env, "GST 5%"),
            &0u64,
            &0u64,
            &true,
            &false,
            &0i128,
        );

        contract.set_tax_jurisdiction(
            &admin,
            &String::from_str(&env, "CA"),
            &str_empty(&env),
            &str_empty(&env),
            &TaxType::Gst,
            &600,
            &String::from_str(&env, "GST 6%"),
            &1_760_000_000u64,
            &0u64,
            &true,
            &false,
            &0i128,
        );

        let log = contract.get_tax_rate_change_log(&String::from_str(&env, "CA"));
        assert!(log.len() >= 1);
    }
}
