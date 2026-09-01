# Subscription Export — Multi-Format Support

## Overview

SubTrackr provides comprehensive subscription data export functionality supporting five accounting formats: **CSV**, **JSON**, **QuickBooks**, **Xero**, and **PDF**. The export system operates at two levels:

1. **Client-side** (`src/services/accountingExport.ts`) — React Native service for mobile export with local storage persistence
2. **Backend** (`backend/services/billing/accountingExportService.ts`) — Server-side streaming export for large datasets with async generators, NDJSON, and progress callbacks

## Supported Formats

| Format     | File Extension | MIME Type          | Use Case                                  |
|------------|----------------|--------------------|--------------------------------------------|
| `csv`      | `.csv`         | `text/csv`         | Generic spreadsheet import                 |
| `json`     | `.json`        | `application/json` | API integrations, schema-validated export  |
| `quickbooks`| `.csv`        | `text/csv`         | QuickBooks accounting software import      |
| `xero`     | `.csv`         | `text/csv`         | Xero accounting software import            |
| `pdf`      | `.pdf`         | `application/pdf`  | Print-ready reports, archival              |

## Client-Side API (`src/services/accountingExport.ts`)

### Quick Start

```typescript
import { export_to_accounting } from './services/accountingExport';

const result = await export_to_accounting('merchant-123', 'quickbooks', {
  subscriptions: mySubscriptions,
  includeInactive: false,
  fieldMappings: [
    { targetField: 'Customer', sourceField: 'merchantId' },
    { targetField: 'Rate', sourceField: 'price', transform: 'currency' },
  ],
  customFields: { accountCode: '400', taxType: 'NONE' },
});

console.log(result.content);      // CSV/JSON/PDF content string
console.log(result.mimeType);     // 'text/csv', 'application/json', or 'application/pdf'
console.log(result.fileName);     // e.g., 'merchant-123-quickbooks-subscription-export-2026-01-15.csv'
console.log(result.checksum);     // Content integrity hash
```

### Available Formats

```typescript
type AccountingFormat = 'csv' | 'json' | 'quickbooks' | 'xero' | 'pdf';
```

### Field Mappings

Customize which subscription fields map to which export columns:

```typescript
import { getAccountingDefaultMapping } from './services/accountingExport';

// Get default QuickBooks mappings
const quickbooksMappings = getAccountingDefaultMapping('quickbooks');

// Custom mappings
const customMappings = [
  { targetField: 'LedgerName', sourceField: 'subscriptionName', transform: 'uppercase' },
  { targetField: 'CustomField', sourceField: 'custom:accountCode', defaultValue: '400' },
];
```

### Transforms

| Transform   | Description                              |
|-------------|------------------------------------------|
| `none`      | No transformation (default)              |
| `uppercase` | Convert to uppercase                     |
| `lowercase` | Convert to lowercase                     |
| `currency`  | Format as currency (2 decimal places)    |
| `date`      | Format as ISO date (YYYY-MM-DD)          |

### Export Options

```typescript
interface ExportOptions {
  subscriptions?: Subscription[];
  includeInactive?: boolean;
  fieldMappings?: AccountingFieldMapping[];
  customFields?: Record<string, string>;
  scheduleId?: string;
  now?: number;                           // Override current timestamp
  transactionTypes?: TransactionType[];   // Filter: 'revenue' | 'refund' | 'credit' | 'fee'
  dateFrom?: number;                      // Unix ms — filter subscriptions with nextBillingDate >= dateFrom
  dateTo?: number;                        // Unix ms — filter subscriptions with nextBillingDate <= dateTo
  includeDeferredRevenue?: boolean;       // Add DeferredRevenue column (GAAP)
  deferredRevenueMap?: Record<string, number>; // Per-subscription deferred revenue
  includeSchema?: boolean;               // Wrap JSON in schema envelope
}
```

### JSON Schema

JSON exports can include a Draft-07 schema envelope:

```typescript
import { get_accounting_json_schema, export_to_accounting } from './services/accountingExport';

// Get the JSON Schema definition
const schema = get_accounting_json_schema();
// schema.$id === 'https://subtrackr.app/schemas/accounting-export.json'

// Export with schema envelope
const result = await export_to_accounting('merchant-1', 'json', {
  subscriptions,
  includeSchema: true,
});

// Result content:
// {
//   "$schema": "https://subtrackr.app/schemas/accounting-export.json",
//   "schemaVersion": "1.0.0",
//   "merchantId": "merchant-1",
//   "exportedAt": "2026-01-15",
//   "recordCount": 5,
//   "records": [...]
// }
```

### Scheduled Exports

```typescript
import { schedule_export, run_due_exports, get_export_schedules } from './services/accountingExport';

// Create a schedule
const schedule = await schedule_export({
  merchantId: 'merchant-1',
  format: 'quickbooks',
  frequency: 'weekly',
  destination: 'download',
  includeInactive: false,
  customFields: { accountCode: '400' },
});

// Run all due schedules
const runs = await run_due_exports(subscriptions);

// List schedules
const schedules = await get_export_schedules();
```

### Export History & Analytics

```typescript
import { get_export_history, get_export_analytics, record_export_download } from './services/accountingExport';

// Get export history
const history = await get_export_history('merchant-1');

// Get analytics
const analytics = await get_export_analytics('merchant-1');
// { totalExports: 12, totalDownloads: 45, successCount: 11, failedCount: 1, formatBreakdown: {...} }

// Record a download
await record_export_download(exportId);
```

## Backend API (`backend/services/billing/accountingExportService.ts`)

### Streaming Export (Sync)

For large datasets, use the callback-based streaming API:

```typescript
import { streamExport } from './accountingExportService';

const records = [/* ... large dataset ... */];
const chunks: string[] = [];

const { totalRecords, checksum } = streamExport(records, {
  format: 'csv',
  filter: { merchantId: 'merchant-1', transactionTypes: ['revenue'] },
  onChunk: (chunk) => chunks.push(chunk),
  chunkSize: 500, // records per chunk
  fieldMappings: customMappings,
  customFields: { accountCode: '400' },
  includeSchema: true, // JSON only
});

const content = chunks.join('');
```

### Async Generator Streaming

For streaming to HTTP responses or file writes without buffering:

```typescript
import { streamExportAsync } from './accountingExportService';

const gen = streamExportAsync(records, {
  format: 'csv',
  chunkSize: 500,
  memoryMonitor: new MemoryMonitor({ heapThresholdBytes: 256 * 1024 * 1024 }),
});

for await (const chunk of gen) {
  res.write(chunk); // Stream to HTTP response
}
```

### NDJSON Streaming

For line-by-line client parsing:

```typescript
import { streamExportNdjson } from './accountingExportService';

for await (const line of streamExportNdjson(records, { chunkSize: 200 })) {
  // Each line is a complete JSON record
  process.stdout.write(line);
}
```

### Streaming with Progress Callbacks

For SSE or UI progress indicators:

```typescript
import { streamExportWithProgress } from './accountingExportService';

const result = await streamExportWithProgress(
  records,
  { format: 'json', chunkSize: 100 },
  async (progress) => {
    console.log(`${progress.percent}% — ${progress.recordsProcessed}/${progress.totalRecords} records`);
    // Send progress event to client
    sseConnection.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
  }
);

console.log(`Export complete: ${result.totalRecords} records, checksum: ${result.checksum}`);
```

### Reconciliation

Verify exported records match expected totals:

```typescript
import { reconcile } from './accountingExportService';

const result = reconcile(exportedRecords, expectedTotals);
console.log(result.isBalanced);    // true/false
console.log(result.mismatches);    // [{ id, reason }]
console.log(result.totalAmount);   // sum of exported amounts
```

### Schedule Management (Backend)

```typescript
import {
  createExportSchedule,
  getExportSchedules,
  updateExportSchedule,
  deleteExportSchedule,
  toggleExportSchedule,
  runDueExports,
} from './accountingExportService';

const schedule = createExportSchedule({
  merchantId: 'merchant-1',
  format: 'json',
  frequency: 'daily',
  enabled: true,
  includeInactive: false,
  nextRunAt: Date.now() + 86400000,
});

toggleExportSchedule(schedule.id, false); // Pause
runDueExports(records, Date.now());       // Run all due schedules
```

## REST API Endpoints

| Method   | Endpoint                          | Handler                    | Description                    |
|----------|-----------------------------------|----------------------------|--------------------------------|
| `POST`   | `/v1/exports`                     | `handleCreateExport`       | Create an export               |
| `GET`    | `/v1/exports/:id`                 | `handleGetExportStatus`    | Get export metadata            |
| `GET`    | `/v1/exports/:id/download`        | `handleDownloadExport`     | Download export content        |
| `PATCH`  | `/v1/exports/:id/download`        | `handleRecordDownload`     | Record a download event        |
| `POST`   | `/v1/exports/schedules`           | `handleCreateSchedule`     | Create a scheduled export      |
| `GET`    | `/v1/exports/schedules`           | `handleGetSchedules`       | List scheduled exports         |
| `PATCH`  | `/v1/exports/schedules/:id`       | `handleUpdateSchedule`     | Update a schedule              |
| `PATCH`  | `/v1/exports/schedules/:id/toggle`| `handleToggleSchedule`     | Enable/disable a schedule      |
| `DELETE` | `/v1/exports/schedules/:id`       | `handleDeleteSchedule`     | Delete a schedule              |
| `GET`    | `/v1/exports/analytics`           | `handleGetAnalytics`       | Get export analytics           |
| `GET`    | `/v1/exports/history`             | `handleGetHistory`         | Get export history             |

## Testing

### Run Client-Side Tests

```bash
npm run test -- --testPathPattern="accountingExport" --passWithNoTests
```

### Run Backend Tests

```bash
npm run test -- --testPathPattern="accountingExportService" --passWithNoTests
```

### Run Backend API Tests

```bash
npm run test -- --testPathPattern="accountingExportApi" --passWithNoTests
```

### Run Performance Benchmarks

```bash
npx jest --config jest.backend.config.js \
  backend/services/billing/__tests__/accountingExportService.benchmark.test.ts \
  --no-coverage --verbose
```

### Performance Budgets

| Metric                     | Budget    |
|----------------------------|-----------|
| CSV export (5k records)    | < 1s      |
| JSON export (5k records)   | < 1.5s    |
| QuickBooks (5k records)    | < 1s      |
| Xero (5k records)          | < 1s      |
| PDF export (1k records)    | < 2s      |
| Async streaming (10k)      | < 2s      |
| Reconciliation (5k)        | < 500ms   |
| Schedule run (1k)          | < 2s      |
