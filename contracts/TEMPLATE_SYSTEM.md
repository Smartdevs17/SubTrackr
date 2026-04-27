# Plan Template System

## Overview

The Plan Template System enables merchants to create reusable subscription plan templates with dynamic pricing tiers, versioning, and safe migration support. Templates provide a structured way to define subscription offerings with quantity-based discounts.

---

## 1. Template Structure

### PlanTemplate

The core data structure for a subscription plan template:

```rust
pub struct PlanTemplate {
    pub id: u64,                 // Auto-increment template ID
    pub merchant: Address,       // Template owner (merchant)
    pub name: String,            // Template name
    pub base_price: i128,        // Base price in stroops (XLM smallest unit)
    pub billing_period: u64,     // Billing period in seconds
    pub tiers: Vec<PricingTier>, // Pricing tiers for dynamic discounts
    pub version: u32,            // Template version (increments on update)
    pub active: bool,            // Whether template is active
    pub created_at: u64,         // Creation timestamp
}
```

### PricingTier

Defines a discount tier based on quantity:

```rust
pub struct PricingTier {
    pub min_quantity: u32, // Minimum quantity to qualify for this tier
    pub discount_bps: u32, // Discount in basis points (0–10000)
}
```

**Basis Points Explanation:**
- 0 bps = 0% discount
- 100 bps = 1% discount
- 1000 bps = 10% discount
- 10000 bps = 100% discount (free)

---

## 2. Pricing Tier Logic

### How It Works

1. **Tier Selection**: When computing a price, the system finds the **best eligible tier** (highest discount) where `quantity >= min_quantity`.

2. **Discount Calculation**: Uses integer math with basis points to avoid floating-point inaccuracies:
   ```
   discount = (base_price * discount_bps) / 10000
   final_price = base_price - discount
   ```

3. **Deterministic Behavior**: The same inputs always produce the same output. No randomness or external state affects pricing.

### Example

Template with base price of 10,000,000 stroops (1 XLM):

```
Tiers:
- 1+ units: 0 bps (0% discount)
- 10+ units: 1000 bps (10% discount)
- 50+ units: 2000 bps (20% discount)
- 100+ units: 3000 bps (30% discount)

Pricing:
- 5 units → 10,000,000 stroops (0% discount)
- 10 units → 9,000,000 stroops (10% discount)
- 50 units → 8,000,000 stroops (20% discount)
- 100 units → 7,000,000 stroops (30% discount)
```

### Overflow Protection

The pricing engine uses `checked_mul` and `checked_sub` to prevent integer overflow:

```rust
let discount = base_price
    .checked_mul(best_discount_bps as i128)
    .expect("Overflow in discount calculation")
    / 10000;

let final_price = base_price
    .checked_sub(discount)
    .expect("Overflow in price calculation");
```

### Non-Negative Guarantee

The system ensures prices never go negative:

```rust
if final_price < 0 {
    panic!("Computed price is negative");
}
```

---

## 3. Versioning Behavior

### Version Increment

Every time a template is updated, its version number increments:

```rust
version: template.version + 1
```

### Subscription Snapshot

When a subscription is created from a template via `apply_template`, it stores:

- `template_id`: Reference to the template
- `template_version`: The version at creation time
- **Resolved price**: Computed at creation and remains immutable

### No Retroactive Changes

**Critical Rule**: Updating a template does NOT affect existing subscriptions.

- **Old subscriptions**: Keep their original `template_version` and price
- **New subscriptions**: Use the latest template version and pricing

### Example Flow

1. Merchant creates template v1 with 10% discount
2. Subscriber A creates subscription → stores `template_version: 1`, price = 9,000,000
3. Merchant updates template to v2 with 20% discount
4. Subscriber B creates subscription → stores `template_version: 2`, price = 8,000,000
5. Subscriber A's subscription remains at 9,000,000 (v1 pricing)

---

## 4. Validation Rules

Templates are validated on creation and update:

### Base Price
- Must be positive (> 0)
- Cannot be zero or negative

### Tiers
- At least one tier required
- Tiers must be sorted by `min_quantity` (ascending)
- No duplicate `min_quantity` values
- `discount_bps` must be in range [0, 10000]
- No tier can result in negative pricing

### Validation Errors

Invalid configurations are rejected early with clear error messages:

- `"Base price must be positive"`
- `"At least one tier required"`
- `"Discount must be 0-10000 bps"`
- `"Tiers must be sorted by min_quantity"`
- `"Duplicate min_quantity in tiers"`
- `"Tier would result in negative pricing"`

---

## 5. Deletion Rules

### Soft Delete (Recommended)

If a template has **active subscriptions**:
- Template is marked as `active = false`
- Template data is preserved
- Existing subscriptions continue unaffected
- New subscriptions cannot be created from this template

### Hard Delete

If a template has **no active subscriptions**:
- Template is permanently removed from storage
- Template is removed from merchant's template index

### Tracking Active Subscriptions

The system tracks template usage:

```rust
StorageKey::TemplateActiveSubscriptions(template_id) -> u32
```

This counter increments when a subscription is created and should decrement when a subscription is cancelled (future enhancement).

---

## 6. Applying Templates

### Flow

1. **Fetch Template**: Retrieve template by ID
2. **Validate Active**: Ensure template is active
3. **Compute Price**: Use pricing engine with quantity
4. **Create Subscription**: Store subscription with template reference
5. **Track Usage**: Increment template's active subscription count

### Function Signature

```rust
pub fn apply_template(
    env: Env,
    proxy: Address,
    storage: Address,
    subscriber: Address,
    template_id: u64,
    quantity: u32,
) -> u64
```

### Parameters

- `subscriber`: Address of the user subscribing
- `template_id`: ID of the template to apply
- `quantity`: Quantity for tier-based pricing

### Returns

- `subscription_id`: ID of the newly created subscription

---

## 7. Storage Structure

### Storage Keys

```rust
// Template data keyed by template ID
Template(u64) -> PlanTemplate

// Global template counter
TemplateCount -> u64

// Merchant's templates index
MerchantTemplates(Address) -> Vec<u64>

// Track active subscriptions per template
TemplateActiveSubscriptions(u64) -> u32
```

### Indexing

Templates are indexed by:
1. **Template ID**: Direct lookup via `Template(template_id)`
2. **Merchant**: List all templates via `MerchantTemplates(merchant)`

---

## 8. CRUD Operations

### Create Template

```rust
create_template(
    merchant,
    name,
    base_price,
    billing_period,
    tiers
) -> template_id
```

- Validates template configuration
- Auto-increments template ID
- Sets version to 1
- Indexes by merchant

### Update Template

```rust
update_template(
    merchant,
    template_id,
    name,
    base_price,
    billing_period,
    tiers
)
```

- Validates ownership (only merchant can update)
- Increments version number
- Preserves `created_at` timestamp
- Validates new configuration

### Get Template

```rust
get_template(template_id) -> PlanTemplate
```

- Returns template data
- Panics if not found

### List Templates

```rust
list_templates(merchant) -> Vec<u64>
```

- Returns all template IDs for a merchant
- Returns empty vector if none exist

### Delete Template

```rust
delete_template(merchant, template_id)
```

- Validates ownership
- Soft deletes if active subscriptions exist
- Hard deletes if safe

---

## 9. Security Features

### Authentication

- All template mutations require `merchant.require_auth()`
- Only the template owner can update or delete
- Proxy authentication required for all contract calls

### Validation

- Invalid configurations rejected early
- No negative pricing allowed
- Overflow protection in price computation
- Tier sorting enforced

### Versioning

- Prevents retroactive pricing changes
- Existing subscriptions locked to original version
- Transparent version tracking

### Access Control

- Templates are private by default (owned by merchant)
- No unauthorized modifications possible
- Merchant cannot delete templates with active subscriptions (soft delete only)

---

## 10. React Native Integration

### TypeScript Types

```typescript
interface PricingTier {
  minQuantity: number;
  discountBps: number; // 0-10000
}

interface PlanTemplate {
  id: string;
  merchant: string;
  name: string;
  basePrice: number;
  billingPeriod: number;
  tiers: PricingTier[];
  version: number;
  active: boolean;
  createdAt: Date;
}
```

### Store Actions

- `createTemplate(data)`: Create new template
- `updateTemplate(id, data)`: Update existing template
- `deleteTemplate(id)`: Delete/deactivate template
- `fetchTemplates()`: Load templates from contract
- `computePreviewPrice(templateId, quantity)`: Preview pricing

### UI Features

- Template list view with status indicators
- Create/edit form with validation
- Dynamic tier configuration
- Live price preview
- Delete confirmation dialogs

---

## 11. Testing

### Test Coverage

The system includes comprehensive tests:

**Pricing Engine:**
- No discount scenarios
- Single tier discount
- Multiple tier boundaries
- Overflow protection
- Negative price prevention

**Validation:**
- Invalid base price
- Invalid discount ranges
- Unsorted tiers
- Duplicate quantities
- Unauthorized updates

**Edge Cases:**
- Boundary quantities
- Version increments
- Old subscription preservation
- Soft delete with active subscriptions
- Hard delete without subscriptions

### Running Tests

```bash
cd contracts
cargo test --package subtrackr-subscription
```

---

## 12. Future Enhancements

Potential improvements for future iterations:

1. **Public Template Sharing**: Allow merchants to share templates publicly
2. **Template Analytics**: Track usage statistics per template
3. **Bulk Operations**: Create/update multiple templates at once
4. **Template Cloning**: Duplicate existing templates
5. **Scheduled Updates**: Plan template version changes in advance
6. **Usage-Based Tiers**: Add duration-based discount tiers
7. **Automatic Decrement**: Decrease `TemplateActiveSubscriptions` on cancellation

---

## 13. Smart Contract Files

- **Types**: `contracts/types/src/lib.rs` - PlanTemplate, PricingTier structs
- **Pricing Engine**: `contracts/subscription/src/pricing.rs` - Price computation
- **Contract Logic**: `contracts/subscription/src/lib.rs` - CRUD operations
- **Tests**: `contracts/subscription/tests/template_test.rs` - Test suite

---

## 14. React Native Files

- **Types**: `src/types/template.ts` - TypeScript interfaces
- **Store**: `src/store/subscriptionStore.ts` - Template state management
- **UI**: `src/screens/PlanTemplatesScreen.tsx` - Template management screen

---

## Summary

The Plan Template System provides a robust, secure, and flexible way to manage subscription plans with dynamic pricing. Key features include:

✅ Deterministic pricing with overflow protection  
✅ Safe versioning without breaking existing subscriptions  
✅ Comprehensive validation and error handling  
✅ Soft delete to protect active subscriptions  
✅ Full React Native UI integration  
✅ Extensive test coverage  

All operations are secure, predictable, and fully tested.
