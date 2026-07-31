# Backend Services Architecture

## Module Boundaries

```
backend/services/
├── container.ts              # IoC Container — sole coupling point
├── index.ts                  # Public API barrel
├── shared/                   # Cross-cutting infrastructure
│   ├── errors.ts             # DomainError base class
│   ├── logging.ts            # Structured logger
│   ├── encryption.ts         # PII encryption & blind indexes
│   ├── apiResponse.ts        # Standard API response envelope
│   ├── apiClient.ts          # HTTP client
│   ├── auditService.ts       # Audit trail
│   ├── monitoring.ts         # Health checks & metrics
│   ├── rateLimitingService.ts # Rate limiting
│   ├── gdpr.ts               # Data subject requests
│   ├── keyManager.ts         # Key rotation
│   └── piiAudit.ts           # PII access audit
├── subscription/             # Subscription domain
│   ├── interfaces.ts         # ISubscriptionEventStore, IElasticsearchService
│   ├── errors.ts             # SubscriptionError + SubscriptionErrorCode
│   ├── subscriptionEventStore.ts
│   ├── ElasticsearchService.ts
│   └── __tests__/
├── billing/                  # Billing domain
│   ├── interfaces.ts         # IMeteringService, IPricingService, ITaxService, etc.
│   ├── errors.ts             # BillingError + BillingErrorCode
│   ├── meteringService.ts
│   ├── pricingService.ts
│   ├── taxService.ts
│   ├── dunningService.ts
│   ├── accountingExportService.ts
│   └── __tests__/
├── notification/             # Notification domain
│   ├── interfaces.ts         # INotificationPreferenceService, IAlertingService, etc.
│   ├── errors.ts             # NotificationError + NotificationErrorCode
│   ├── preferenceService.ts
│   ├── alerting.ts
│   ├── webhook.ts
│   ├── websocket.ts
│   └── __tests__/
└── analytics/                # Analytics domain
    ├── interfaces.ts         # IPredictionService, IRecommendationService, etc.
    ├── errors.ts             # AnalyticsError + AnalyticsErrorCode
    ├── campaignService.ts
    ├── complianceReport.ts
    ├── dataPipeline.ts
    ├── dataWarehouse.ts
    ├── predictionService.ts
    ├── recommendationService.ts
    ├── retentionService.ts
    ├── oracleMonitorService.ts
    └── __tests__/
```

## Domain Modules

### subscription
**Responsibility:** Subscription lifecycle, event sourcing, full-text search.
**Interfaces:** `ISubscriptionEventStore`, `IElasticsearchService`
**Depends on:** `shared` (errors, types, logging)
**DOES NOT depend on:** `billing`, `notification`, `analytics`

### billing
**Responsibility:** Usage metering, pricing, tax calculation, dunning, accounting exports.
**Interfaces:** `IMeteringService`, `IPricingService`, `ITaxService`, `IDunningService`, `IAccountingExportService`
**Depends on:** `shared` (errors, types, logging)
**DOES NOT depend on:** `subscription`, `notification`, `analytics`

### notification
**Responsibility:** Push notifications, webhooks, alerts, WebSocket real-time, user preferences.
**Interfaces:** `INotificationPreferenceService`, `IAlertingService`, `IWebhookDeliveryService`, `IWebsocketService`
**Depends on:** `shared` (errors, types, logging)
**DOES NOT depend on:** `subscription`, `billing`, `analytics`

### analytics
**Responsibility:** Campaigns, churn prediction, recommendations, compliance reports, oracle data.
**Interfaces:** `IPredictionService`, `IRecommendationService`, `IComplianceReportService`, `ICampaignService`
**Depends on:** `shared` (errors, types, logging)
**DOES NOT depend on:** `subscription`, `billing`, `notification`

## Dependency Injection

All cross-module communication flows through the `Container` in `container.ts`. Modules NEVER import concrete classes from sibling domains — they only depend on interfaces registered with I-prefix tokens.

```typescript
// ✅ CORRECT — resolve via container
const billing = container.resolve<IBillingService>('IBillingService');

// ❌ WRONG — direct cross-module import
import { SubscriptionEventStore } from '../subscription/subscriptionEventStore';
```

### Container API

| Method | Description |
|--------|-------------|
| `register(token, instance)` | Register an eager singleton |
| `bind(token, factory, lifetime?)` | Lazy binding (singleton by default) |
| `bindTransient(token, factory)` | New instance on every resolve |
| `resolve(token)` | Resolve a dependency (throws if missing) |
| `tryResolve(token)` | Resolve or return null |
| `has(token)` | Check if token is registered |
| `registerModule(reg)` | Bulk-register module bindings |
| `disposeAll()` | Call dispose() on all Disposable singletons |
| `clear()` | Reset all bindings (test isolation) |
| `listTokens()` | List all registered tokens |

## Error Handling

Each module has its own error class extending `DomainError` and a set of typed error codes:

- `SubscriptionError` / `SubscriptionErrorCode` — `SUB_NOT_FOUND`, `SUB_EVENT_STORE_FULL`, etc.
- `BillingError` / `BillingErrorCode` — `BILL_PAYMENT_FAILED`, `BILL_TAX_CALCULATION_FAILED`, etc.
- `NotificationError` / `NotificationErrorCode` — `NOTIF_DELIVERY_FAILED`, `NOTIF_WEBHOOK_HEALTH_FAILED`, etc.
- `AnalyticsError` / `AnalyticsErrorCode` — `ANALYTICS_PREDICTION_FAILED`, `ANALYTICS_INSUFFICIENT_DATA`, etc.

Every error includes a factory method for common cases (e.g. `SubscriptionError.notFound(id)`).

## Anti-Patterns (Avoid)

1. **Cross-module imports of concrete classes** — Always use interfaces + container
2. **Circular dependencies between modules** — Container detects and throws
3. **Shared mutable state** — Each module owns its own state
4. **Direct filesystem access between modules** — Use the shared infrastructure layer
5. **Module A importing from module B's internal utils** — Abstract via shared/ or interfaces

## Testing

Each module has `__tests__/module.test.ts` validating:
- Error codes are unique and correctly typed
- DI container bindings resolve correctly
- Container edge cases (circular deps, missing tokens, transient vs singleton)

Run module-level tests:
```bash
npm test -- --testPathPattern="backend/services/.*/module.test.ts"
```
