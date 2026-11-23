# Administrator subscription management console (#2199)

The console backend lives in `backend/services/admin/`:

- `subscriptionConsole.ts` — permission-checked subscription lifecycle service,
  in-memory store, pagination, summary and audit trail.
- `subscriptionConsoleRouter.ts` — Express-compatible route registration.
- `src/services/subscriptionConsoleClient.ts` — typed React Native client.

## Endpoints

All endpoints are mounted under an authenticated admin router. The actor id is
read from `req.actorId` (populated by the auth middleware); it is never accepted
from the request body.

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `GET` | `/admin/subscriptions` | `subscriptions:read` | Filter by status/owner/plan/search; `limit` (max 100) and `offset`. |
| `GET` | `/admin/subscriptions/summary` | `subscriptions:read` | Counts by status and active+trialing+past-due MRR. |
| `GET` | `/admin/subscriptions/audit` | `audit_logs:read` | Newest-first immutable action log. |
| `GET` | `/admin/subscriptions/:id` | `subscriptions:read` | Single subscription. |
| `POST` | `/admin/subscriptions/:id/pause` | `subscriptions:update` | Pause an active or trialing subscription; requires `reason`. |
| `POST` | `/admin/subscriptions/:id/resume` | `subscriptions:update` | Resume a paused subscription. |
| `POST` | `/admin/subscriptions/:id/cancel` | `subscriptions:delete` | Cancel a non-terminal subscription; requires `reason`. |
| `PATCH` | `/admin/subscriptions/:id/plan` | `subscriptions:update` | Change plan without resetting lifecycle state. |
| `POST` | `/admin/subscriptions/bulk-pause` | `subscriptions:update` | Validate every target, then pause each eligible one; returns per-id failures. |

Successful responses use `{ "success": true, "data": ... }`; failures use the
canonical error envelope with codes `FORBIDDEN`, `NOT_FOUND`,
`INVALID_TRANSITION` and `VALIDATION_ERROR`.

## Lifecycle rules

| Current status | Pause | Resume | Cancel | Change plan |
| --- | --- | --- | --- | --- |
| `trialing` | yes | no | yes | yes |
| `active` | yes | no | yes | yes |
| `paused` | no | yes | yes | yes |
| `past_due` | no | no | yes | no |
| `canceled` | no | no | no | no |

Every accepted mutation writes an audit record containing the actor, action,
subscription id, reason and the before/after status and plan. Bulk actions are
all-or-nothing per subscription (invalid targets are reported, not silently
skipped) so an operator can retry only the failed ids.

## Mounting

```ts
import { registerSubscriptionConsoleRoutes } from './services/admin/subscriptionConsoleRouter';
import { SubscriptionConsoleService } from './services/admin/subscriptionConsole';

registerSubscriptionConsoleRoutes(
  adminRouter,
  new SubscriptionConsoleService({ store, accessControl })
);
```

Replace `InMemorySubscriptionConsoleStore` with a Postgres-backed implementation
of `SubscriptionConsoleStore` in production; the service and routes are
persistence-agnostic.

Unit tests: `backend/services/admin/__tests__/subscriptionConsole.test.ts`.
