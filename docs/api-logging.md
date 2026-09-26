## Logging System

SubTrackr uses a centralized structured logging system across backend and client services.  
It replaces `console.log` with a consistent, queryable logger for debugging, auditing, and tracing subscription + blockchain flows.

---

### Why Logging Exists

The logging system helps with:

- Debugging subscription and payment issues
- Tracking Soroban smart contract interactions
- Tracing wallet connection flows (Freighter / Web3Auth)
- Monitoring failed or delayed charges
- Supporting future analytics and observability tools

---

### Logger Import

Use the shared logging service:

```ts
import { logger } from "@/services/logging";
Log Levels
Level	When to Use
debug	Development-only diagnostic info
info	Normal application events
warn	Unexpected but recoverable issues
error	Failures that require attention
Basic Usage
Info logs (normal flows)
logger.info("Subscription created", {
  userId: "user_123",
  subscriptionId: "sub_456",
  planId: 1
});
Debug logs (development tracing)
logger.debug("Charging subscription initiated", {
  subscriptionId: "sub_456",
  nextChargeAt: 1710000000
});
Warning logs (non-fatal issues)
logger.warn("Low wallet balance detected", {
  userId: "user_123",
  balance: "0.8 XLM"
});
Error logs (failures)
logger.error("Subscription charge failed", {
  subscriptionId: "sub_456",
  error: "Insufficient funds",
  txHash: "0xabc123"
});
Correlation IDs (Critical for Debugging)

Correlation IDs allow tracing a full user journey across multiple services:

App (React Native)
Wallet layer
Backend services
Soroban smart contract calls
Creating a Correlation Flow
const correlationId = logger.createCorrelationId();

logger.info("Subscription flow started", { correlationId });

logger.info("Wallet authorization complete", {
  correlationId,
  walletAddress: "GABC..."
});

logger.info("Executing blockchain payment", {
  correlationId,
  subscriptionId: "sub_123"
});

logger.info("Subscription flow completed", {
  correlationId
});
Migration from console.log

All existing logs must be migrated.

Old (do not use)
console.log("User subscribed successfully");
New (recommended)
logger.info("User subscribed successfully");
Best Practices
Always include relevant context (userId, subscriptionId, txHash)
Use error only for actual failures
Avoid logging sensitive data (private keys, auth tokens)
Use debug for internal state inspection only
Keep logs structured (never plain strings only)

### Log Aggregation
The backend supports forwarding structured events to a centralized endpoint using `LOG_REMOTE_ENDPOINT`.
Set `BACKEND_LOG_LEVEL` and `BACKEND_LOG_LEVELS` to tune verbosity globally or per module.

### Queryable Log Buffer
A local query API is available in backend services for dashboard-style filtering:
```ts
import { queryLogs } from '../backend/services/logging';
const logs = queryLogs({
  level: 'error',
  module: 'backend:gdpr',
  correlationId: 'corr-id-123',
  text: 'export',
});
```

Backend Logging Coverage

Logging should be used in:

walletService.ts → wallet connection + transactions
notificationService.ts → reminders + alerts
subscription flows → create, pause, cancel, charge
gdpr.ts → export + delete actions
Soroban contract wrappers → transaction lifecycle
Future Enhancements

Planned improvements to the logging system:

Log aggregation (e.g. Datadog / Loki)
Real-time error alerting (Sentry integration)
Dashboard for subscription activity logs
On-chain ↔ off-chain log correlation mapping
```
