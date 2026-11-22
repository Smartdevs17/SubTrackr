# Component-Based Email Template Engine

## Overview

The `EmailTemplateEngine` replaces raw HTML string concatenation with a structured, composable component system. Templates are assembled from typed building blocks — `header`, `text`, `button`, `divider`, `image`, `spacer`, `columns`, `footer` — each responsible for its own HTML output.

**File:** `backend/services/notification/emailTemplateEngine.ts`

---

## Architecture

```
EmailTemplateEngine
├── ComponentRenderer   — maps each ComponentType → HTML string
├── LayoutRegistry      — 4 named layouts (default, minimal, branded, transactional)
├── Template Registry   — CRUD for ComponentTemplate objects
└── BUILTIN_TEMPLATES   — 4 pre-built templates (payment_failed, renewal_reminder,
                          subscription_cancelled, welcome)
```

---

## Quick Start

```typescript
import { emailTemplateEngine } from 'backend/services/notification';

// Render a built-in template
const { subject, html, missingVariables } = emailTemplateEngine.render(
  'payment_failed',
  {
    merchant_name:      'Acme Corp',
    subscriber_name:    'Jane Doe',
    subscription_name:  'Pro Plan',
    amount:             '29.99',
    currency:           'USD',
    invoice_url:        'https://app.acme.com/inv/123',
    support_email:      'help@acme.com',
  }
);
```

---

## Component Types

| Type       | Description                          | Key Props                              |
|------------|--------------------------------------|----------------------------------------|
| `header`   | Top banner / logo area               | `content`, `backgroundColor`, `color` |
| `text`     | Paragraph text                       | `content`, `fontSize`, `color`        |
| `html`     | Raw HTML passthrough                 | `content`                              |
| `button`   | CTA button with link                 | `label`, `href`, `backgroundColor`    |
| `divider`  | Horizontal rule                      | `color`, `padding`                     |
| `image`    | Inline image, optional link wrapper  | `src`, `alt`, `width`, `link`          |
| `spacer`   | Vertical whitespace                  | `height_px`                            |
| `columns`  | Multi-column layout                  | `columns` (array of component arrays)  |
| `footer`   | Small-print footer                   | `content`, `color`, `fontSize`         |

All `content` / `subject` strings support `{{variable}}` substitution.

---

## Layouts

| Name             | Background    | Max Width | Best For                     |
|------------------|---------------|-----------|------------------------------|
| `default`        | `#f4f4f5`     | 600px     | General transactional emails |
| `minimal`        | `#ffffff`     | 560px     | Plain prose emails           |
| `branded`        | `#1e1b4b`     | 640px     | Marketing / welcome emails   |
| `transactional`  | `#f8fafc`     | 600px     | Invoices, payment alerts     |

Override at render time:
```typescript
engine.render('renewal_reminder', vars, { layoutOverride: 'minimal' });
```

---

## Built-in Templates

| ID                       | Trigger                    | Layout          |
|--------------------------|----------------------------|-----------------|
| `payment_failed`         | `payment.failed`           | `transactional` |
| `renewal_reminder`       | `subscription.renewal_due` | `default`       |
| `subscription_cancelled` | `subscription.cancelled`   | `transactional` |
| `welcome`                | `subscriber.created`       | `branded`       |

---

## Custom Templates

```typescript
import {
  emailTemplateEngine,
  PRESET_COMPONENTS,
} from 'backend/services/notification';

emailTemplateEngine.upsertTemplate({
  id: 'trial_expiring',
  name: 'Trial Expiring Soon',
  trigger: 'trial.expiring',
  subject: 'Your trial ends in 3 days, {{subscriber_name}}',
  layout: 'default',
  variables: ['subscriber_name', 'merchant_name', 'invoice_url', 'support_email'],
  components: [
    PRESET_COMPONENTS.brandedHeader(),
    PRESET_COMPONENTS.spacer(24),
    PRESET_COMPONENTS.greeting(),
    PRESET_COMPONENTS.body(
      'Your free trial ends in 3 days. Upgrade now to keep access to all features.'
    ),
    PRESET_COMPONENTS.spacer(24),
    PRESET_COMPONENTS.ctaButton('Upgrade Now', '{{invoice_url}}'),
    PRESET_COMPONENTS.divider(),
    PRESET_COMPONENTS.supportFooter(),
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
```

---

## Migration from Legacy Block-Based Templates

The engine provides a `fromLegacyBlocks()` helper for gradual migration:

```typescript
const migratedTemplate = engine.fromLegacyBlocks(
  'my_template_id',
  'My Template',
  'payment.failed',
  '{{merchant_name}} — Payment Failed',
  existingTemplate.locales[0].blocks,   // TemplateBlock[] from old EmailTemplateService
  'transactional'
);
engine.registerTemplate(migratedTemplate);
```

Block type mapping:
- `header` → `header` component
- `body`   → `text` component
- `cta_button` → `button` component (href defaults to `{{invoice_url}}`)
- `divider` → `divider` component
- `footer` → `footer` component
- `image` → `image` component

---

## Variable Detection

`render()` always returns `missingVariables: string[]`. Log or alert on non-empty arrays in production:

```typescript
const { missingVariables } = engine.render('payment_failed', vars);
if (missingVariables.length > 0) {
  logger.warn({ missingVariables }, 'Email template rendered with missing variables');
}
```

---

## Performance

- Rendering is synchronous and CPU-only (no I/O, no network).
- A typical template renders in < 1 ms.
- Template objects are stored in a `Map` — O(1) lookup.
- Safe to call on every outbound email without caching.
