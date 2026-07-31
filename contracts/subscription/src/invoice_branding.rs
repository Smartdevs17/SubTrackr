use soroban_sdk::{contracttype, Env, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvoiceBranding {
    pub logo_url: String,
    pub primary_color: String,
    pub font_family: String,
    pub template_id: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BrandingStorageKey {
    InvoiceBranding(String), // tenant_id -> InvoiceBranding
}

pub fn set_invoice_branding(env: &Env, tenant_id: String, branding: InvoiceBranding) {
    env.storage().persistent().set(&BrandingStorageKey::InvoiceBranding(tenant_id), &branding);
}

pub fn get_invoice_branding(env: &Env, tenant_id: String) -> Option<InvoiceBranding> {
    env.storage().persistent().get(&BrandingStorageKey::InvoiceBranding(tenant_id))
}
