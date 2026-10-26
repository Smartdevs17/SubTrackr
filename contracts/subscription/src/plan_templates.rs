#![allow(dead_code)]
//! Plan template library for SubTrackr merchants.
//!
//! A template is a reusable blueprint for a plan: a base price, a billing
//! interval, an optional graduated pricing ladder and a feature list. Merchants
//! instantiate a plan from a template — optionally overriding price, interval
//! or name — instead of rebuilding one from scratch every time.
//!
//! The module covers:
//!
//! * **Library** — templates are owned by a merchant and listed per owner.
//! * **Dynamic pricing tiers** — a graduated ladder priced per unit, so one
//!   template can serve usage-based plans.
//! * **Customization** — per-instantiation overrides that never mutate the
//!   template itself.
//! * **Versioning** — publishing a change creates a new version chained to the
//!   same root, leaving already-instantiated plans on the version they used.
//! * **Sharing** — a template can be published to a shared library that other
//!   merchants may instantiate but never edit.
//! * **Analytics** — views, plans created and subscriptions started, with
//!   adoption and conversion rates in basis points.
//!
//! All storage is delegated to the shared storage contract via the
//! `storage_persistent_*` helpers defined in the parent module.

use soroban_sdk::{contracttype, Address, Env, String, Vec};
use subtrackr_types::{Interval, StorageKey, TemplateKey};

use crate::{storage_persistent_get, storage_persistent_set};

/// Denominator for the basis-point rates reported by [`TemplateAnalytics`].
pub const BPS_DENOMINATOR: u32 = 10_000;

/// Ceiling on tiers in one template, bounding the cost of a price quote.
pub const MAX_TIERS: u32 = 12;

/// Ceiling on features listed by one template.
pub const MAX_FEATURES: u32 = 32;

// ── Types ─────────────────────────────────────────────────────────────────────

/// One rung of a graduated pricing ladder.
///
/// `up_to_units` is the inclusive upper bound of the rung in units; `None`
/// means unbounded and is only valid on the last rung.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PricingTier {
    pub up_to_units: Option<u64>,
    pub unit_price: i128,
}

/// A reusable plan blueprint.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PlanTemplate {
    pub id: u64,
    /// First version's id. Equal to `id` for a first version.
    pub root_id: u64,
    pub version: u32,
    pub owner: Address,
    pub name: String,
    pub description: String,
    /// Flat price per interval, used when `tiers` is empty.
    pub base_price: i128,
    pub token: Address,
    pub interval: Interval,
    /// Graduated ladder; empty for a flat-priced template.
    pub tiers: Vec<PricingTier>,
    pub features: Vec<String>,
    /// Published to the shared library, so other merchants may instantiate it.
    pub shared: bool,
    /// A superseded version stays readable but cannot be instantiated.
    pub active: bool,
    pub created_at: u64,
}

/// Per-instantiation overrides. Every field is optional; `None` keeps the
/// template's value.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TemplateOverrides {
    pub name: Option<String>,
    pub price: Option<i128>,
    pub interval: Option<Interval>,
    pub token: Option<Address>,
}

/// The concrete plan parameters a template resolves to.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedPlan {
    pub template_id: u64,
    pub name: String,
    pub price: i128,
    pub token: Address,
    pub interval: Interval,
}

/// Usage and conversion counters for one template.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TemplateAnalytics {
    pub template_id: u64,
    /// Times the template was previewed in the library.
    pub views: u32,
    /// Plans instantiated from the template.
    pub plans_created: u32,
    /// Subscriptions started against those plans.
    pub subscriptions_started: u32,
    /// `plans_created / views` in basis points.
    pub adoption_bps: u32,
    /// `subscriptions_started / plans_created` in basis points.
    pub conversion_bps: u32,
    pub last_used_at: u64,
}

impl TemplateAnalytics {
    pub fn empty(template_id: u64) -> Self {
        TemplateAnalytics {
            template_id,
            views: 0,
            plans_created: 0,
            subscriptions_started: 0,
            adoption_bps: 0,
            conversion_bps: 0,
            last_used_at: 0,
        }
    }

    fn recompute_derived(&mut self) {
        self.adoption_bps = ratio_bps(self.plans_created, self.views);
        self.conversion_bps = ratio_bps(self.subscriptions_started, self.plans_created);
    }
}

/// `numerator / denominator` in basis points, saturating at 100% and returning
/// `0` for an empty denominator.
pub fn ratio_bps(numerator: u32, denominator: u32) -> u32 {
    if denominator == 0 {
        return 0;
    }
    let raw = (numerator as u64 * BPS_DENOMINATOR as u64) / denominator as u64;
    if raw > BPS_DENOMINATOR as u64 {
        BPS_DENOMINATOR
    } else {
        raw as u32
    }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/// A ladder is valid when it is non-empty within [`MAX_TIERS`], strictly
/// ascending, priced non-negatively, and unbounded only on its last rung.
pub fn validate_tiers(tiers: &Vec<PricingTier>) -> bool {
    let len = tiers.len();
    if len == 0 || len > MAX_TIERS {
        return false;
    }

    let mut previous: u64 = 0;
    for (i, tier) in tiers.iter().enumerate() {
        if tier.unit_price < 0 {
            return false;
        }
        match tier.up_to_units {
            None => {
                // Only the last rung may be unbounded.
                if (i as u32) + 1 != len {
                    return false;
                }
            }
            Some(bound) => {
                if bound == 0 || bound <= previous {
                    return false;
                }
                previous = bound;
            }
        }
    }
    true
}

/// A template is valid when its price is positive, its ladder (if any) is
/// valid, and its feature list stays within [`MAX_FEATURES`].
pub fn validate_template(
    base_price: i128,
    tiers: &Vec<PricingTier>,
    features: &Vec<String>,
) -> bool {
    if base_price <= 0 {
        return false;
    }
    if features.len() > MAX_FEATURES {
        return false;
    }
    tiers.is_empty() || validate_tiers(tiers)
}

/// Price `units` against a graduated ladder: each rung prices only the units
/// that fall inside it.
pub fn calculate_tiered_price(tiers: &Vec<PricingTier>, units: u64) -> i128 {
    let mut remaining = units;
    let mut lower_bound: u64 = 0;
    let mut total: i128 = 0;

    for tier in tiers.iter() {
        if remaining == 0 {
            break;
        }
        let capacity = match tier.up_to_units {
            None => remaining,
            Some(bound) => bound.saturating_sub(lower_bound),
        };
        let units_in_tier = if remaining < capacity {
            remaining
        } else {
            capacity
        };
        total += units_in_tier as i128 * tier.unit_price;
        remaining -= units_in_tier;
        if let Some(bound) = tier.up_to_units {
            lower_bound = bound;
        }
    }

    total
}

/// Price a template for `units` of usage: the ladder when the template defines
/// one, otherwise the flat base price.
pub fn quote_template(template: &PlanTemplate, units: u64) -> i128 {
    if template.tiers.is_empty() {
        template.base_price
    } else {
        calculate_tiered_price(&template.tiers, units)
    }
}

/// Apply overrides to a template without mutating it.
pub fn resolve_plan(template: &PlanTemplate, overrides: &TemplateOverrides) -> ResolvedPlan {
    ResolvedPlan {
        template_id: template.id,
        name: overrides.name.clone().unwrap_or(template.name.clone()),
        price: overrides.price.unwrap_or(template.base_price),
        token: overrides.token.clone().unwrap_or(template.token.clone()),
        interval: overrides
            .interval
            .clone()
            .unwrap_or(template.interval.clone()),
    }
}

/// A template may be instantiated by its owner, or by anyone once shared.
/// Superseded versions are never instantiable.
pub fn can_instantiate(template: &PlanTemplate, caller: &Address) -> bool {
    template.active && (template.shared || &template.owner == caller)
}

// ── Storage helpers ───────────────────────────────────────────────────────────

pub fn get_template(env: &Env, storage: &Address, template_id: u64) -> Option<PlanTemplate> {
    storage_persistent_get(
        env,
        storage,
        StorageKey::PlanTemplate(TemplateKey::Template(template_id)),
    )
}

fn put_template(env: &Env, storage: &Address, template: &PlanTemplate) {
    storage_persistent_set(
        env,
        storage,
        StorageKey::PlanTemplate(TemplateKey::Template(template.id)),
        template.clone(),
    );
}

pub fn get_owner_templates(env: &Env, storage: &Address, owner: &Address) -> Vec<u64> {
    storage_persistent_get(
        env,
        storage,
        StorageKey::PlanTemplate(TemplateKey::ByOwner(owner.clone())),
    )
    .unwrap_or(Vec::new(env))
}

pub fn get_shared_templates(env: &Env, storage: &Address) -> Vec<u64> {
    storage_persistent_get(env, storage, StorageKey::PlanTemplate(TemplateKey::Shared))
        .unwrap_or(Vec::new(env))
}

/// Every version id of a template chain, oldest first.
pub fn get_template_versions(env: &Env, storage: &Address, root_id: u64) -> Vec<u64> {
    storage_persistent_get(
        env,
        storage,
        StorageKey::PlanTemplate(TemplateKey::Versions(root_id)),
    )
    .unwrap_or(Vec::new(env))
}

/// The newest version of a template chain.
pub fn get_latest_version(env: &Env, storage: &Address, root_id: u64) -> Option<PlanTemplate> {
    let versions = get_template_versions(env, storage, root_id);
    versions
        .last()
        .and_then(|id| get_template(env, storage, id))
}

pub fn get_analytics(env: &Env, storage: &Address, template_id: u64) -> TemplateAnalytics {
    storage_persistent_get(
        env,
        storage,
        StorageKey::PlanTemplate(TemplateKey::Analytics(template_id)),
    )
    .unwrap_or(TemplateAnalytics::empty(template_id))
}

fn put_analytics(env: &Env, storage: &Address, analytics: &TemplateAnalytics) {
    storage_persistent_set(
        env,
        storage,
        StorageKey::PlanTemplate(TemplateKey::Analytics(analytics.template_id)),
        analytics.clone(),
    );
}

fn next_template_id(env: &Env, storage: &Address) -> u64 {
    let count: u64 =
        storage_persistent_get(env, storage, StorageKey::PlanTemplate(TemplateKey::Count))
            .unwrap_or(0);
    let next = count + 1;
    storage_persistent_set(
        env,
        storage,
        StorageKey::PlanTemplate(TemplateKey::Count),
        next,
    );
    next
}

fn index_for_owner(env: &Env, storage: &Address, owner: &Address, template_id: u64) {
    let mut owned = get_owner_templates(env, storage, owner);
    owned.push_back(template_id);
    storage_persistent_set(
        env,
        storage,
        StorageKey::PlanTemplate(TemplateKey::ByOwner(owner.clone())),
        owned,
    );
}

fn append_version(env: &Env, storage: &Address, root_id: u64, template_id: u64) {
    let mut versions = get_template_versions(env, storage, root_id);
    versions.push_back(template_id);
    storage_persistent_set(
        env,
        storage,
        StorageKey::PlanTemplate(TemplateKey::Versions(root_id)),
        versions,
    );
}

// ── Operations ────────────────────────────────────────────────────────────────

/// Register the first version of a template. Panics on an invalid definition.
pub fn create_template(
    env: &Env,
    storage: &Address,
    owner: &Address,
    name: String,
    description: String,
    base_price: i128,
    token: Address,
    interval: Interval,
    tiers: Vec<PricingTier>,
    features: Vec<String>,
) -> u64 {
    assert!(
        validate_template(base_price, &tiers, &features),
        "Invalid plan template"
    );

    let id = next_template_id(env, storage);
    let template = PlanTemplate {
        id,
        root_id: id,
        version: 1,
        owner: owner.clone(),
        name,
        description,
        base_price,
        token,
        interval,
        tiers,
        features,
        shared: false,
        active: true,
        created_at: env.ledger().timestamp(),
    };

    put_template(env, storage, &template);
    index_for_owner(env, storage, owner, id);
    append_version(env, storage, id, id);
    put_analytics(env, storage, &TemplateAnalytics::empty(id));

    id
}

/// Publish a new version of `template_id`, superseding it.
///
/// The previous version is deactivated but kept readable, so plans already
/// instantiated from it stay explainable. Analytics start fresh for the new
/// version, since they measure that version's own performance.
pub fn publish_version(
    env: &Env,
    storage: &Address,
    caller: &Address,
    template_id: u64,
    name: String,
    description: String,
    base_price: i128,
    tiers: Vec<PricingTier>,
    features: Vec<String>,
) -> u64 {
    let mut previous = get_template(env, storage, template_id).expect("Template not found");
    assert!(&previous.owner == caller, "Only the owner may publish");
    assert!(
        validate_template(base_price, &tiers, &features),
        "Invalid plan template"
    );

    let was_shared = previous.shared;
    let id = next_template_id(env, storage);
    let template = PlanTemplate {
        id,
        root_id: previous.root_id,
        version: previous.version + 1,
        owner: previous.owner.clone(),
        name,
        description,
        base_price,
        token: previous.token.clone(),
        interval: previous.interval.clone(),
        tiers,
        features,
        // Sharing carries across versions, so a shared template stays in the
        // library at its newest version.
        shared: was_shared,
        active: true,
        created_at: env.ledger().timestamp(),
    };

    // The superseded version stays readable but leaves the shared library, so
    // it can neither be instantiated nor browsed.
    previous.active = false;
    previous.shared = false;
    put_template(env, storage, &previous);

    put_template(env, storage, &template);
    index_for_owner(env, storage, &template.owner, id);
    append_version(env, storage, template.root_id, id);
    put_analytics(env, storage, &TemplateAnalytics::empty(id));

    if was_shared {
        set_shared_membership(env, storage, template_id, false);
        set_shared_membership(env, storage, id, true);
    }

    id
}

/// Publish a template to, or withdraw it from, the shared library.
pub fn set_shared(env: &Env, storage: &Address, caller: &Address, template_id: u64, shared: bool) {
    let mut template = get_template(env, storage, template_id).expect("Template not found");
    assert!(&template.owner == caller, "Only the owner may share");

    if template.shared == shared {
        return;
    }
    template.shared = shared;
    put_template(env, storage, &template);
    set_shared_membership(env, storage, template_id, shared);
}

fn set_shared_membership(env: &Env, storage: &Address, template_id: u64, member: bool) {
    let current = get_shared_templates(env, storage);
    let mut next: Vec<u64> = Vec::new(env);
    let mut present = false;
    for id in current.iter() {
        if id == template_id {
            present = true;
            if !member {
                continue;
            }
        }
        next.push_back(id);
    }
    if member && !present {
        next.push_back(template_id);
    }
    storage_persistent_set(
        env,
        storage,
        StorageKey::PlanTemplate(TemplateKey::Shared),
        next,
    );
}

/// Resolve a template into concrete plan parameters, recording the usage.
///
/// Returns the parameters for the caller to create a plan with; the template
/// itself is never mutated by an instantiation.
pub fn instantiate(
    env: &Env,
    storage: &Address,
    caller: &Address,
    template_id: u64,
    overrides: TemplateOverrides,
) -> ResolvedPlan {
    let template = get_template(env, storage, template_id).expect("Template not found");
    assert!(
        can_instantiate(&template, caller),
        "Template is not available to this caller"
    );

    let resolved = resolve_plan(&template, &overrides);
    assert!(resolved.price > 0, "Resolved price must be positive");

    let mut analytics = get_analytics(env, storage, template_id);
    analytics.plans_created += 1;
    analytics.last_used_at = env.ledger().timestamp();
    analytics.recompute_derived();
    put_analytics(env, storage, &analytics);

    resolved
}

/// Record that the template was previewed in the library.
pub fn record_view(env: &Env, storage: &Address, template_id: u64) {
    let mut analytics = get_analytics(env, storage, template_id);
    analytics.views += 1;
    analytics.recompute_derived();
    put_analytics(env, storage, &analytics);
}

/// Record that a plan instantiated from the template gained a subscriber.
pub fn record_subscription(env: &Env, storage: &Address, template_id: u64) {
    let mut analytics = get_analytics(env, storage, template_id);
    analytics.subscriptions_started += 1;
    analytics.last_used_at = env.ledger().timestamp();
    analytics.recompute_derived();
    put_analytics(env, storage, &analytics);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::vec;

    fn tier(up_to: Option<u64>, price: i128) -> PricingTier {
        PricingTier {
            up_to_units: up_to,
            unit_price: price,
        }
    }

    #[test]
    fn ratio_bps_handles_empty_and_saturating_denominators() {
        assert_eq!(ratio_bps(0, 0), 0);
        assert_eq!(ratio_bps(5, 0), 0);
        assert_eq!(ratio_bps(1, 4), 2_500);
        assert_eq!(ratio_bps(4, 4), 10_000);
        // More conversions than plans cannot exceed 100%.
        assert_eq!(ratio_bps(9, 4), 10_000);
    }

    #[test]
    fn validates_ascending_bounded_ladders() {
        let env = Env::default();
        assert!(validate_tiers(&vec![
            &env,
            tier(Some(1_000), 0),
            tier(Some(10_000), 10),
            tier(None, 5),
        ]));

        // Empty ladder.
        assert!(!validate_tiers(&Vec::<PricingTier>::new(&env)));
        // Descending bounds.
        assert!(!validate_tiers(&vec![
            &env,
            tier(Some(10_000), 10),
            tier(Some(1_000), 5),
        ]));
        // Unbounded rung before the end.
        assert!(!validate_tiers(&vec![
            &env,
            tier(None, 10),
            tier(Some(50), 5)
        ]));
        // Negative unit price.
        assert!(!validate_tiers(&vec![&env, tier(None, -1)]));
    }

    #[test]
    fn validates_template_definitions() {
        let env = Env::default();
        let no_tiers: Vec<PricingTier> = Vec::new(&env);
        let features: Vec<String> = Vec::new(&env);

        assert!(validate_template(100, &no_tiers, &features));
        // A flat template still needs a positive price.
        assert!(!validate_template(0, &no_tiers, &features));
        assert!(!validate_template(-1, &no_tiers, &features));
        // A supplied ladder must itself be valid.
        assert!(!validate_template(
            100,
            &vec![&env, tier(Some(0), 1)],
            &features
        ));
    }

    #[test]
    fn prices_units_across_the_ladder() {
        let env = Env::default();
        let tiers = vec![
            &env,
            tier(Some(1_000), 0),
            tier(Some(10_000), 10),
            tier(None, 5),
        ];

        // Entirely inside the free rung.
        assert_eq!(calculate_tiered_price(&tiers, 500), 0);
        // 1,000 free then 1,000 at 10.
        assert_eq!(calculate_tiered_price(&tiers, 2_000), 10_000);
        // 1,000 free, 9,000 at 10, 5,000 at 5.
        assert_eq!(calculate_tiered_price(&tiers, 15_000), 90_000 + 25_000);
        assert_eq!(calculate_tiered_price(&tiers, 0), 0);
    }

    #[test]
    fn ladder_caps_at_the_last_bounded_rung() {
        let env = Env::default();
        // No unbounded rung: units past the top bound are not charged.
        let tiers = vec![&env, tier(Some(100), 7)];
        assert_eq!(calculate_tiered_price(&tiers, 250), 700);
    }
}
