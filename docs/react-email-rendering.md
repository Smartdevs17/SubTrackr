# React Email Transactional Email Rendering

Issue #2214 — Component-based email templating system for billing notifications.

## Overview

SubTrackr sends transactional emails (receipts, invoices, password resets, etc.)
from the backend. The existing system uses a component-based template engine
(`EmailTemplateEngine`) that renders templates by concatenating HTML strings.
This refactor introduces a **React Email-compatible** component system that
mirrors the `@react-email/components` API (Section, Text, Button, Hr, …) and
renders to table-based HTML without requiring `react-dom`.

## Why Not `@react-email/render`?

React Email's `render()` function requires `react-dom/server`, which is not
available in this Node.js backend (the project uses React Native, not React
for web). Instead, we adopt the same component API and render the component
tree ourselves, producing the same table-based HTML that React Email outputs.

This gives us:

1. **Component-level reuse** — templates assembled from typed building blocks.
2. **Email-client compatibility** — table-based layouts with inline styles.
3. **Forward compatibility** — component descriptors are shaped like React
   elements (`{ type, props }`), so swapping in actual React Email components
   requires only a thin adapter.
4. **HTML + plain text** — the renderer produces both, as the existing system
   already expects.

## Components

| Component | File | Purpose |
|-----------|------|---------|
| `ReactEmailRenderer` | `backend/services/notification/reactEmailRenderer.ts` | Renders component tree to HTML + text |
| `Section`, `Text`, `Button`, `Hr`, `Spacer`, `Footer`, `Img`, `Row`, `Column`, `Heading`, `Container` | same | Primitive component builders mirroring `@react-email/components` |
| `reactEmailTemplates.ts` | `backend/services/notification/reactEmailTemplates.ts` | 8 transactional template definitions |
| `ReactEmailPreviewService` | `src/services/reactEmailPreviewService.ts` | Frontend preview service |

## Template IDs

Same as the legacy system:

- `receipt_payment_succeeded`
- `invoice_due`
- `invoice_overdue`
- `payment_method_updated`
- `refund_issued`
- `subscription_renewed`
- `password_reset`
- `email_verification`

## Usage

### Backend: render a receipt email

```typescript
import { renderReactEmailTemplate } from './reactEmailTemplates';

const result = renderReactEmailTemplate('receipt_payment_succeeded', {
  merchant_name: 'Acme Inc',
  subscriber_name: 'Alice',
  support_email: 'help@acme.com',
  subscription_name: 'Pro Plan',
  amount: '29.99',
  currency: 'USD',
  paid_at: '2024-07-01',
  receipt_url: 'https://acme.com/receipt/123',
});

// result.html — full HTML email
// result.text — plain text alternative
// result.subject — resolved subject line
```

### Backend: custom renderer with branded styling

```typescript
import { ReactEmailRenderer } from './reactEmailRenderer';
import { REACT_EMAIL_TEMPLATES } from './reactEmailTemplates';

const brandedRenderer = new ReactEmailRenderer({
  backgroundColor: '#1e1b4b',
  contentBackgroundColor: '#ffffff',
  maxWidth: 640,
  fontFamily: 'Arial, sans-serif',
});

const result = brandedRenderer.render(
  REACT_EMAIL_TEMPLATES.invoice_due,
  { variables: { /* ... */ } },
);
```

### Frontend: preview a template

```typescript
import { ReactEmailPreviewService } from '../services/reactEmailPreviewService';

const service = ReactEmailPreviewService.getInstance();
const preview = await service.preview({
  templateId: 'invoice_due',
  variables: {
    merchant_name: 'Acme Inc',
    subscriber_name: 'Alice',
    // ... all required variables
  },
});
// preview.html — rendered HTML for preview iframe
```

## Required Variable Enforcement

Like the legacy `renderTransactionalEmail`, the React Email renderer enforces
required variables at render time. If a required variable is missing or empty,
the render throws an error listing the missing variables. If the rendered
output contains an unresolved `{{placeholder}}`, the render also throws.

## Testing

```bash
npx jest --config jest.backend.config.js \
  --testMatch '**/backend/services/notification/__tests__/reactEmailTemplates.test.ts' \
  --coverage \
  --collectCoverageFrom='backend/services/notification/reactEmailRenderer.ts' \
  --collectCoverageFrom='backend/services/notification/reactEmailTemplates.ts'
```

Coverage: 96% statements, 81% branches, 100% functions, 100% lines.
