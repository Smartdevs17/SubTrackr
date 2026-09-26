# Plan Templates

## Overview

Merchants were building every plan from scratch. Plan templates are reusable
blueprints — a base price, a billing cycle, an optional graduated pricing ladder
and a feature list — that a merchant instantiates a plan from, optionally
customized, in one step.

The feature spans four layers:

| Layer      | Location                                          | Responsibility                                    |
| ---------- | ------------------------------------------------- | ------------------------------------------------- |
| Contract   | `contracts/subscription/src/plan_templates.rs`    | On-chain registry, versioning, sharing, analytics  |
| Backend    | `backend/services/billing/planTemplateService.ts` | Billing-domain library and quoting                |
| Store      | `src/store/planTemplateStore.ts`                  | Client library, filters, analytics                |
| UI         | `src/screens/PlanTemplatesScreen.tsx`             | Browse, quote, customize, instantiate             |

`src/types/planTemplate.ts` is the shared vocabulary across the TypeScript
layers, and mirrors the contract's types.

## Template anatomy

```ts
interface PlanTemplate {
  id: string;
  rootId: string;      // first version's id; equal to id for a first version
  version: number;
  ownerId: string;
  name: string;
  description: string;
  category: SubscriptionCategory;
  billingCycle: BillingCycle;
  currency: string;
  basePrice: number;              // flat price per interval
  pricingModel: 'flat' | 'tiered';
  tiers: PricingTier[];           // graduated ladder; empty for a flat template
  features: TemplateFeature[];
  shared: boolean;                // published to the shared library
  active: boolean;                // false once superseded by a newer version
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

A `PlanTemplateDraft` is the same shape minus identity, ownership, version and
lifecycle, all of which are assigned on publish.

## Library

`createTemplate(ownerId, draft)` publishes version 1. The library is browsed
with a filter:

```ts
usePlanTemplateStore.getState().listTemplates({
  pricingModel: 'tiered',
  tags: ['api'],
  search: 'usage',
});
```

`listAvailableTemplates(callerId)` returns everything a caller may instantiate:
their own templates plus every shared one. Superseded versions are excluded from
both unless `includeInactive` is set.

An empty client library is seeded with `STARTER_TEMPLATES` (Starter, Team and a
usage-based API plan) so a new merchant has something to instantiate on day one.
`seedStarterTemplates` is a no-op once the library holds anything.

## Dynamic pricing tiers

A `tiered` template prices usage with a graduated ladder — each rung prices only
the units that fall inside it:

```ts
tiers: [
  { upToUnits: 1_000,  unitPrice: 0 },      // first 1,000 free
  { upToUnits: 10_000, unitPrice: 0.01 },   // next 9,000 at a cent
  { upToUnits: null,   unitPrice: 0.005 },  // everything above at half a cent
]
```

`quote(templateId, units)` returns the total, the per-rung breakdown, and the
effective unit price. 15,000 units against the ladder above cost
`0 + 9,000 × 0.01 + 5,000 × 0.005 = 115`.

A ladder is valid when it is non-empty within `MAX_TIERS` (12), strictly
ascending, priced non-negatively, and unbounded only on its last rung. A ladder
with no unbounded rung stops charging past its top bound. Tiers supplied out of
order are sorted before quoting.

A `flat` template quotes its base price regardless of units. Tiers attached to a
flat template are ignored, which validation reports as a warning rather than an
error.

## Customization

Instantiating never mutates the template. Overrides apply to that one plan:

```ts
const resolved = await useSubscriptionStore.getState().addFromTemplate(
  merchantId,
  templateId,
  { name: 'Team (EU)', price: 59, currency: 'EUR', removeFeatureKeys: ['sso'] },
);
```

Omitted fields keep the template's value. A resolved price of zero or less is
rejected, so an override cannot produce a free plan by accident.

`addFromTemplate` resolves the template, creates the subscription, and records
the conversion — but only if the subscription actually landed, so a failed
create does not inflate the template's conversion rate.

## Versioning

Templates are immutable once published. Editing means publishing a new version:

```
v1 ──▶ v2 ──▶ v3      all sharing one rootId
 │       │
 │       └─ active: false once v3 publishes
 └─ active: false once v2 publishes
```

`publishVersion(ownerId, templateId, draft)` creates the new version, chains it
to the same `rootId`, and retires the previous one. A superseded version stays
readable — so plans already created from it remain explainable — but cannot be
instantiated, and leaves the shared library.

Each version carries its own analytics, since the counters measure how that
version performed. `listVersions(rootId)` returns the chain oldest first;
`getLatestVersion(rootId)` returns its head.

## Sharing

`setShared(ownerId, templateId, shared)` publishes a template to a library other
merchants can browse and instantiate but never edit — only the owner may publish
a version or change sharing. Sharing carries across versions, so a shared
template stays in the library at its newest version while the superseded one is
withdrawn. A superseded version cannot be shared.

## Analytics

Per template:

| Metric                          | Meaning                                          |
| ------------------------------- | ------------------------------------------------ |
| `views`                         | Times the template was previewed in the library  |
| `plansCreated`                  | Plans instantiated from it                       |
| `subscriptionsStarted`          | Subscriptions started against those plans        |
| `revenue`                       | Revenue attributed to those subscriptions        |
| `adoptionRate`                  | `plansCreated / views`, 0-1                      |
| `conversionRate`                | `subscriptionsStarted / plansCreated`, 0-1       |
| `averageRevenuePerSubscription` | `revenue / subscriptionsStarted`                 |
| `lastUsedAt`                    | Last instantiation or subscription               |

Rates are capped at 100%, so a template whose plans each gained several
subscribers reports `1` rather than an impossible rate.

`getLibraryAnalytics(filter)` rolls these up across a filtered slice and ranks
`topTemplateIds` by subscriptions started.

On-chain, `get_plan_template_analytics(template_id)` returns the same counters
with `adoption_bps` and `conversion_bps` in basis points (`10_000` == 100%).

## Contract API

```rust
create_plan_template(proxy, storage, owner, name, description, base_price, token, interval, tiers, features) -> u64
publish_plan_template_version(proxy, storage, owner, template_id, name, description, base_price, tiers, features) -> u64
share_plan_template(proxy, storage, owner, template_id, shared)
create_plan_from_template(proxy, storage, merchant, template_id, overrides) -> u64
quote_plan_template(proxy, storage, template_id, units) -> i128

get_plan_template(proxy, storage, template_id) -> Option<PlanTemplate>
list_owner_plan_templates(proxy, storage, owner) -> Vec<u64>
list_shared_plan_templates(proxy, storage) -> Vec<u64>
list_plan_template_versions(proxy, storage, root_id) -> Vec<u64>
get_latest_plan_template(proxy, storage, root_id) -> Option<PlanTemplate>
get_plan_template_analytics(proxy, storage, template_id) -> TemplateAnalytics
record_plan_template_view(proxy, storage, template_id)
record_plan_template_subscription(proxy, storage, template_id)
```

`create_plan_from_template` resolves the template and forwards the result to
`create_plan`, so template-created plans are ordinary plans with no special
casing downstream.

Template state lives behind a single `StorageKey::PlanTemplate(TemplateKey)`
variant — the feature namespaces its keys rather than adding six flat variants
to the shared storage key enum.

## Testing

```bash
# Billing domain
npx jest -c jest.backend.config.js backend/services/billing/__tests__/planTemplateService.test.ts

# Client store
npx jest src/store/__tests__/planTemplateStore.test.ts

# Contract
cd contracts && cargo test -p subtrackr-subscription
```
