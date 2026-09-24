# GDPR Data Export and Deletion Tools

## Overview

Implements GDPR Article 20 (Right to Data Portability) and Article 17 (Right to Erasure)
with a complete data export and deletion workflow.

## Data Export Service

- Collects user data from all registered sources
- Three export levels: `full`, `pseudonymized`, `anonymized`
- Applies PII anonymization strategies from the PII registry
- Generates SHA-256 checksum for integrity verification

## Data Deletion Service

- Grace period (default 30 days) before deletion executes
- Cancellation allowed during grace period
- Cascading deletion across all registered data stores
- Per-source deletion results tracking

## Controller Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/gdpr/export` | Export user data |
| POST | `/gdpr/deletion` | Create deletion request |
| POST | `/gdpr/deletion/:id/cancel` | Cancel deletion request |
| POST | `/gdpr/deletion/:id/execute` | Execute deletion (after grace period) |
| GET | `/gdpr/deletion/:id` | Get deletion request status |
| GET | `/gdpr/deletion?userId=...` | List user's deletion requests |

## Usage

```typescript
import { DataExportService, DataDeletionService, GdprController } from './gdpr';

const exportService = new DataExportService();
exportService.registerCollector({
  sourceName: 'subscriptions',
  collect: async (userId) => { /* fetch user subscriptions */ },
});

const deletionService = new DataDeletionService(30);
deletionService.registerDeleter({
  sourceName: 'subscriptions',
  deleteUserData: async (userId) => { /* delete user data */ },
});

const controller = new GdprController({ exportService, deletionService });
```
