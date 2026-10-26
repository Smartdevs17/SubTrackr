# SubTrackr Export Guide

SubTrackr provides multi-format subscription data export, scheduled automation, export analytics, and a REST API for third-party integrations.

---

## Table of Contents

1. [Supported Formats](#supported-formats)
2. [Custom Columns & Field Mappings](#custom-columns--field-mappings)
3. [JSON Schema Specification](#json-schema-specification)
4. [Scheduled Export Automation](#scheduled-export-automation)
5. [Export Analytics](#export-analytics)
6. [REST API Reference](#rest-api-reference)
7. [Frontend Service API](#frontend-service-api)

---

## Supported Formats

| Format | Extension | MIME Type | Description |
|---|---|---|---|
| `csv` | `.csv` | `text/csv` | Generic tabular export with all standard columns |
| `json` | `.json` | `application/json` | Full JSON array (or schema-wrapped envelope) |
| `quickbooks` | `.csv` | `text/csv` | QuickBooks-compatible CSV with Customer, Product/Service, Amount columns |
| `xero` | `.csv` | `text/csv` | Xero-compatible CSV with ContactName, InvoiceNumber, UnitAmount columns |
| `pdf` | `.pdf` | `application/pdf` | Formatted tabular report for printing and archival |

### CSV Export (`csv`)

Default columns: `TransactionId`, `MerchantId`, `SubscriptionId`, `Name`, `Description`, `Category`, `Type`, `Amount`, `Currency`, `BillingCycle`, `BillingDate`, `DeferredRevenue`, `CreatedAt`.

All values are NFC-normalized and properly quoted to handle commas, quotes, and international characters.

### JSON Export (`json`)

Returns a JSON array of subscription records by default, or a schema-wrapped envelope when `includeSchema: true`.

**Bare array example:**
```json
[
  {
    "merchantId": "merchant-123",
    "subscriptionId": "sub_abc",
    "subscriptionName": "Slack",
    "transactionType": "revenue",
    "price": 12.50,
    "currency": "USD",
    "billingCycle": "monthly",
    "nextBillingDate": "2026-02-01",
    "status": "active",
    "createdAt": "2025-12-01",
    "updatedAt": "2026-01-01"
  }
]
```

### QuickBooks Export (`quickbooks`)

Columns: `Customer`, `Product/Service`, `Description`, `Qty`, `Rate`, `Amount`, `Currency`, `Service Date`, `Memo`.

Import via QuickBooks → **Sales → Products and Services → Import**.

### Xero Export (`xero`)

Columns: `ContactName`, `InvoiceNumber`, `InvoiceDate`, `DueDate`, `Description`, `Quantity`, `UnitAmount`, `AccountCode`, `TaxType`, `Currency`.

Import via Xero → **Accounts → Sales → Import**.

### PDF Export (`pdf`)

Generates a minimal, zero-dependency PDF file containing a formatted subscription table. Uses ASCII/Latin-1 PDF streams — compatible with React Native, Hermes, and Node.js without any native PDF dependencies.

Each PDF page contains:
- Export title and merchant ID
- Generation timestamp
- Record count
- Tabular data: Name, Price, Billing Cycle, Next Billing Date, Status (and Deferred Revenue if enabled)

---

## Custom Columns & Field Mappings

Both CSV formats and accounting exports support custom column configurations via `fieldMappings`.

### Field Mapping Structure

```typescript
interface AccountingFieldMapping {
  targetField: string;          // Output column header name
  sourceField: AccountingSourceField; // Source data field
  defaultValue?: string;        // Fallback if source is empty
  transform?: AccountingTransform;    // Value transformation
}
```

### Source Fields

| Source Field | Description |
|---|---|
| `merchantId` | Merchant identifier |
| `subscriptionId` | Subscription ID |
| `subscriptionName` | Subscription name |
| `description` | Subscription description |
| `category` | Category (software, streaming, etc.) |
| `price` | Numeric price |
| `currency` | Currency code |
| `billingCycle` | Billing cycle (monthly, yearly, etc.) |
| `nextBillingDate` | Next billing date |
| `status` | `active` or `inactive` |
| `createdAt` | Creation date |
| `updatedAt` | Last updated date |
| `custom:KEY` | Any custom field value from `customFields` |

### Transforms

| Transform | Effect |
|---|---|
| `none` | No transformation (default) |
| `uppercase` | Convert value to UPPERCASE |
| `lowercase` | Convert value to lowercase |
| `currency` | Format as decimal with 2 decimal places (e.g., `12.50`) |
| `date` | Format as ISO date string `YYYY-MM-DD` |

### Example: Custom Mapping

```typescript
import { export_to_accounting } from './services/accountingExport';

const result = await export_to_accounting('merchant-123', 'csv', {
  subscriptions,
  fieldMappings: [
    { targetField: 'LedgerName', sourceField: 'subscriptionName', transform: 'uppercase' },
    { targetField: 'Amount',     sourceField: 'price',            transform: 'currency' },
    { targetField: 'AccountCode',sourceField: 'custom:accountCode', defaultValue: '400' },
  ],
  customFields: { accountCode: '455' },
});
```

### Custom Field Values

Pass key-value pairs in `customFields` to populate `custom:KEY` source fields:

```typescript
customFields: {
  accountCode: '455',
  taxType: 'OUTPUT',
  quantity: '2',
}
```

---

## JSON Schema Specification

When `includeSchema: true` is set, JSON exports include a [JSON Schema Draft-07](https://json-schema.org/draft-07) envelope.

### Schema-wrapped export structure

```json
{
  "$schema": "https://subtrackr.app/schemas/accounting-export.json",
  "schemaVersion": "1.0.0",
  "merchantId": "merchant-123",
  "exportedAt": "2026-01-15",
  "recordCount": 42,
  "records": [ /* ... subscription records ... */ ]
}
```

### Record Schema (Draft-07)

| Property | Type | Required | Description |
|---|---|---|---|
| `merchantId` | string | ✅ | Merchant identifier |
| `subscriptionId` | string | ✅ | Subscription ID |
| `subscriptionName` | string | ✅ | Subscription name |
| `description` | string | ❌ | Optional description |
| `category` | string | ❌ | Category |
| `transactionType` | `revenue \| refund \| credit \| fee` | ✅ | Transaction type |
| `price` | number ≥ 0 | ✅ | Subscription price |
| `currency` | string (3 chars) | ✅ | ISO 4217 currency code |
| `billingCycle` | string | ✅ | Billing frequency |
| `nextBillingDate` | date string | ✅ | ISO-8601 date |
| `status` | `active \| inactive` | ✅ | Subscription status |
| `createdAt` | date string | ✅ | ISO-8601 date |
| `updatedAt` | date string | ✅ | ISO-8601 date |
| `deferredRevenue` | string | ❌ | Deferred revenue decimal (GAAP) |

### Retrieve the schema programmatically

```typescript
import { get_accounting_json_schema } from './services/accountingExport';

const schema = get_accounting_json_schema();
// Returns the full JSON Schema Draft-07 object
```

---

## Scheduled Export Automation

### Create a schedule

```typescript
import { schedule_export } from './services/accountingExport';

const schedule = await schedule_export({
  merchantId: 'merchant-123',
  format: 'quickbooks',
  frequency: 'weekly',        // 'daily' | 'weekly' | 'monthly'
  destination: 'download',    // 'download' | 'email' | 'webhook'
  includeInactive: false,
  fieldMappings: [...],       // optional custom mappings
  customFields: { accountCode: '400' },
});

console.log(`Next run: ${new Date(schedule.nextRunAt).toISOString()}`);
```

### Run due schedules

Call `run_due_exports` periodically (e.g., from a background job or app foreground event) to execute all schedules that are past their `nextRunAt` time:

```typescript
import { run_due_exports } from './services/accountingExport';

const runs = await run_due_exports(subscriptions);
console.log(`${runs.length} scheduled export(s) executed`);
```

After each run, the schedule's `lastRunAt` is updated and `nextRunAt` is advanced by one frequency period.

### Run a specific schedule immediately

```typescript
import { run_export_schedule } from './services/accountingExport';

const run = await run_export_schedule(scheduleId, subscriptions);
if (run) {
  console.log(`Exported ${run.result.itemCount} records`);
}
```

### Toggle a schedule on/off

```typescript
import { toggle_export_schedule } from './services/accountingExport';

await toggle_export_schedule(scheduleId, false); // pause
await toggle_export_schedule(scheduleId, true);  // resume
```

### Delete a schedule

```typescript
import { delete_export_schedule } from './services/accountingExport';

await delete_export_schedule(scheduleId);
```

### Schedule fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Auto-generated unique schedule ID |
| `merchantId` | string | Merchant this schedule belongs to |
| `format` | AccountingFormat | Export format |
| `frequency` | `daily \| weekly \| monthly` | How often to run |
| `destination` | `download \| email \| webhook` | Where to send the export |
| `enabled` | boolean | Whether the schedule is active |
| `nextRunAt` | number | Unix ms timestamp for the next run |
| `lastRunAt` | number | Unix ms timestamp of last run |
| `fieldMappings` | AccountingFieldMapping[] | Custom column mappings |
| `customFields` | Record\<string, string\> | Custom field values |

---

## Export Analytics

SubTrackr tracks download counts and format usage across all exports.

### Get analytics

```typescript
import { get_export_analytics } from './services/accountingExport';

const analytics = await get_export_analytics('merchant-123');
// or omit merchantId to get global analytics
```

### Analytics shape

```typescript
interface ExportAnalytics {
  totalExports: number;         // Total number of export runs
  totalDownloads: number;       // Sum of all download events
  successCount: number;         // Successful exports
  failedCount: number;          // Failed exports
  totalItemsExported: number;   // Sum of all itemCount values
  formatBreakdown: {            // Count per format
    csv: number;
    json: number;
    quickbooks: number;
    xero: number;
    pdf: number;
  };
}
```

### Record a download

When a user downloads or copies an export, call `record_export_download` to track it:

```typescript
import { record_export_download } from './services/accountingExport';

const updated = await record_export_download(exportId);
// updated.downloadCount is now incremented
```

### Export history

Retrieve the export history log (up to 50 most recent entries):

```typescript
import { get_export_history } from './services/accountingExport';

const history = await get_export_history('merchant-123');
// Each entry: { id, merchantId, format, status, itemCount, fileName, downloadCount, createdAt, ... }
```

---

## REST API Reference

The backend billing domain exposes a complete export REST API via `backend/services/billing/exportApi.ts`.

### POST `/v1/exports`

Trigger an export in any format.

**Request body:**
```json
{
  "format": "pdf",
  "records": [...],
  "filter": {
    "merchantId": "merchant-123",
    "dateFrom": 1700000000000,
    "dateTo": 1750000000000,
    "transactionTypes": ["revenue"]
  },
  "fieldMappings": [...],
  "customFields": { "accountCode": "400" },
  "includeSchema": false
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "exportId": "exp_m1yz3d_abc123",
    "merchantId": "merchant-123",
    "format": "pdf",
    "fileName": "merchant-123-pdf-export-2026-01-15.pdf",
    "mimeType": "application/pdf",
    "itemCount": 42,
    "checksum": "a1b2c3d4"
  },
  "message": "Export created successfully"
}
```

---

### GET `/v1/exports/:id`

Retrieve export metadata.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "exportId": "exp_m1yz3d_abc123",
    "format": "quickbooks",
    "fileName": "merchant-123-quickbooks-export-2026-01-15.csv",
    "mimeType": "text/csv",
    "itemCount": 12,
    "checksum": "a1b2c3d4",
    "createdAt": 1753500000000
  }
}
```

---

### GET `/v1/exports/:id/download`

Download the export file. Returns the file content with appropriate headers:

```
Content-Type: text/csv
Content-Disposition: attachment; filename="merchant-123-quickbooks-export-2026-01-15.csv"
X-Export-Checksum: a1b2c3d4
X-Export-Item-Count: 12
```

> [!NOTE]
> Every download via this endpoint automatically increments the download counter.

---

### PATCH `/v1/exports/:id/download`

Manually record a download event (for client-side delivery tracking).

---

### POST `/v1/exports/schedules`

Create an automated export schedule.

**Request body:**
```json
{
  "merchantId": "merchant-123",
  "format": "xero",
  "frequency": "weekly",
  "enabled": true,
  "includeInactive": false,
  "nextRunAt": 1753600000000
}
```

---

### GET `/v1/exports/schedules?merchantId=merchant-123`

List export schedules.

---

### PATCH `/v1/exports/schedules/:id`

Update a schedule (partial update). Use `{ "enabled": false }` to pause.

---

### DELETE `/v1/exports/schedules/:id`

Permanently delete a schedule.

---

### GET `/v1/exports/analytics?merchantId=merchant-123`

Retrieve aggregated export analytics.

---

### GET `/v1/exports/history?merchantId=merchant-123`

Retrieve export history log.

---

## Frontend Service API

The `src/services/accountingExport.ts` module (re-exported from `app/services/accountingExport.ts`) is the primary mobile frontend service.

| Function | Description |
|---|---|
| `export_to_accounting(merchantId, format, options)` | Run an export and persist to history |
| `get_export_history(merchantId?)` | Get history entries |
| `schedule_export(config)` | Create a schedule |
| `get_export_schedules()` | List all schedules |
| `update_export_schedule(schedule)` | Update a schedule |
| `delete_export_schedule(scheduleId)` | Delete a schedule |
| `toggle_export_schedule(scheduleId, enabled)` | Enable/disable a schedule |
| `run_due_exports(subscriptions, now?)` | Execute all due schedules |
| `run_export_schedule(scheduleId, subscriptions, now?)` | Execute one schedule now |
| `record_export_download(exportId)` | Increment download counter |
| `get_export_analytics(merchantId?)` | Get aggregated analytics |
| `get_accounting_json_schema()` | Retrieve the JSON Schema Draft-07 definition |
| `getAccountingDefaultMapping(format)` | Get default field mappings for a format |
| `buildAccountingExportCsv(...)` | Build a CSV string directly (no history) |
| `ACCOUNTING_EXPORT_JSON_SCHEMA` | The raw JSON Schema constant |

---

> [!TIP]
> For advanced use cases requiring large-dataset streaming, reconciliation against expected totals, or server-side schedule orchestration, use the backend `streamExport`, `reconcile`, and `runDueExports` functions from `backend/services/billing/accountingExportService.ts`.
