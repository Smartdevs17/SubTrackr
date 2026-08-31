# Input Validation with Zod Schemas and Sanitization

## Overview

Issue #771 implements comprehensive input validation across the SubTrackr backend using Zod schemas, XSS sanitization, SQL injection prevention, file upload validation, and request body size limits.

## Architecture

```
backend/services/shared/
├── validationMiddleware.ts   # Core validation engine
├── schemas.ts                # Zod schemas for all API endpoints
└── index.ts                  # Exports
```

## Features

### 1. Zod Schema Validation

All request bodies, query parameters, and path parameters are validated against typed Zod schemas:

```typescript
import { validateRequest, createPlanSchema } from '../shared';

const result = validateRequest(
  { body: req.body, query: req.query, params: req.params },
  { body: createPlanSchema, query: planQuerySchema }
);

if (!result.success) {
  // Return structured validation errors
}
```

### 2. XSS Sanitization

String inputs are automatically sanitized to prevent stored XSS attacks:

- HTML tag stripping (`<script>`, `<img onerror=...>`)
- JavaScript protocol removal (`javascript:`)
- Event handler removal (`onclick=`, `onerror=`)
- Data URI sanitization

### 3. SQL Injection Prevention

Pattern-based detection for common SQL injection vectors:

- UNION-based injection
- Stacked queries (`; DROP TABLE`)
- Boolean-based injection (`1=1`)
- Comment-based injection (`--`, `/* */`)

### 4. File Upload Validation

```typescript
import { validateFileUpload } from '../shared';

const result = validateFileUpload(
  { name: 'report.pdf', size: 1024000, type: 'application/pdf' },
  { maxFileSizeBytes: 5 * 1024 * 1024, allowedExtensions: ['.pdf', '.csv'] }
);
```

### 5. Request Body Size Limits

Configurable size limits for different endpoint types:

| Limit    | Size     | Use Case           |
|----------|----------|--------------------|
| small    | 1KB      | Simple forms       |
| medium   | 100KB    | Standard JSON      |
| large    | 1MB      | File metadata      |
| max      | 10MB     | Bulk operations    |

### 6. Express-style Middleware

```typescript
import { createValidationMiddleware, createPlanSchema } from '../shared';

app.post('/plans',
  createValidationMiddleware({ body: createPlanSchema }),
  (req, res) => { /* handler */ }
);
```

## Available Schemas

### Plan Schemas
- `createPlanSchema` – POST /plans
- `updatePlanSchema` – PATCH /plans/:id
- `planQuerySchema` – GET /plans

### Subscription Schemas
- `createSubscriptionSchema` – POST /subscriptions
- `updateSubscriptionSchema` – PATCH /subscriptions/:id
- `cancelSubscriptionSchema` – POST /subscriptions/:id/cancel
- `pauseSubscriptionSchema` – POST /subscriptions/:id/pause
- `subscriptionQuerySchema` – GET /subscriptions

### Payment Schemas
- `paymentRequestSchema` – POST /payments/charge
- `refundRequestSchema` – POST /payments/refund
- `paymentQuerySchema` – GET /payments

### Webhook Schemas
- `createWebhookSchema` – POST /webhooks

### Analytics Schemas
- `analyticsQuerySchema` – GET /analytics
- `forecastRequestSchema` – POST /analytics/forecast

### Fallback Schemas
- `fallbackChainSchema` – POST /payment/fallback-chains
- `fallbackQuerySchema` – GET /payment/fallback-history

### CORS Schemas
- `corsPolicySchema` – POST /cors/policies

## Error Response Format

Validation errors follow the standard API response envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "body.name": "String must contain at least 1 character(s)",
      "body.amount": "Amount must be positive"
    }
  }
}
```

## Security Considerations

1. **XSS Prevention**: All string inputs are sanitized before processing
2. **SQL Injection**: Pattern-based detection blocks suspicious inputs
3. **Size Limits**: Prevents denial-of-service via oversized payloads
4. **Type Safety**: Zod schemas enforce strict type checking
5. **Strip Unknown**: Unknown properties are removed from validated objects
