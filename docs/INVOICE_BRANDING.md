# Per-Tenant Invoice Branding

One SubTrackr deployment issues invoices on behalf of many merchants. An
invoice's appearance is therefore a property of its **tenant**, not of the
platform: two invoices from the same instance should look like they came from
two different companies.

| Piece | Where |
|---|---|
| Branding registry and resolution | `src/store/invoiceStore.ts` |
| Rendering and delivery | `backend/services/billing/invoiceCustomizationService.ts` |
| Types | `src/types/invoice.ts` |

## Resolution order

`resolveBranding(tenantId?)` layers three sources, most specific first:

```
tenant profile  →  platform default (InvoiceConfig)  →  built-in fallback
```

Merging is **field by field**, not all-or-nothing. A tenant that overrides only
its logo still inherits the platform palette and font — otherwise every tenant
would have to restate the entire theme to change one thing.

The result reports which layer supplied it via `source`
(`'tenant' | 'platform' | 'fallback'`), which is what the branding preview needs
to tell a merchant whether they are looking at their own theme or the default.

A tenant pointing at a template that has since been deleted falls back to the
platform template rather than rendering nothing. `removeTemplate()` likewise
clears `config.defaultTemplateId` when it removes the template it points at, so
the config can never dangle.

## Configuring a tenant

```ts
useInvoiceStore.getState().setTenantBranding('tenant-acme', {
  displayName: 'Acme Inc.',
  numberingPrefix: 'ACME',          // ACME-000001 instead of INV-000001
  templateId: 'tpl-2',              // standard | modern | minimalist
  branding: {
    logoUrl: 'https://cdn.acme.example/logo.png',
    primaryColor: '#ff5722',
    secondaryColor: '#fff3e0',
    accentColor: '#2e7d32',
    fontFamily: 'Inter, sans-serif',
    footerText: 'Payable within 14 days.',
    supportEmail: 'billing@acme.example',
    websiteUrl: 'https://acme.example',
  },
});
```

`setTenantBranding` and `updateTenantBranding` **throw** on an invalid profile
rather than storing it — an invalid theme is caught at the settings screen, not
at render time in front of a payer. `updateTenantBranding` validates the
*merged* result, so a patch cannot make a stored profile invalid.

`validateInvoiceBranding()` returns **every** problem rather than stopping at the
first, so the branding editor can highlight all offending fields in one pass.

## Rendering

```ts
const rendered = InvoiceCustomizationService.renderInvoice(invoice);
rendered.html;   // self-contained document for the PDF pipeline
rendered.text;   // plain-text alternative for the email body
```

Rendering is **deterministic and side-effect free**: the same invoice plus the
same branding always produce byte-identical markup. That is what makes the
output snapshot-testable, cacheable, and safe to re-render when a dispute needs
the exact document a payer saw.

Precedence within a render:

1. `invoice.branding` — branding frozen onto the invoice when it was issued.
2. The tenant profile as it stands now.

An issued invoice keeps the brand it was issued under; a rebrand does not
retroactively rewrite history. `previewForTenant()` deliberately ignores frozen
branding, because a preview should show the profile as it is right now.

## Security

Every branding value is attacker-controlled — a tenant types it into a form —
so all of it is escaped or scheme-checked before reaching the markup:

| Field | Treatment |
|---|---|
| All text (`displayName`, line items, footer) | HTML-escaped, no exceptions |
| Colours | Must match `#rgb`/`#rrggbb`, else replaced with the fallback |
| `logoUrl` | Only `http(s):` and `data:image/` survive; `javascript:` is dropped |
| `websiteUrl` | `http(s):` only |
| `fontFamily` | Stripped to `[A-Za-z0-9 ,-]` — quotes and `;` would let a tenant close the CSS declaration and inject their own |
| `logoWidth` | Clamped to 24–320pt |

Validation at write time and sanitization at render time are both present on
purpose: the store can be populated by a migration or a direct `setState` that
never passed through validation, and the renderer is the last line before the
document reaches a payer.

## Storage

Branding profiles and templates persist with the invoice store
(`subtrackr-invoices`, schema v2). v1 payloads predate the registry; they
migrate to an empty registry, which resolves to the platform defaults — exactly
the v1 behaviour.

## Testing

- `src/store/__tests__/invoiceBranding.test.ts` — validation, registry CRUD,
  resolution precedence, template fallback.
- `backend/services/billing/__tests__/invoiceCustomizationService.test.ts` —
  sanitization, escaping, layout selection, determinism, delivery.
