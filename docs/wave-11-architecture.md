# Architecture changes: repositories, detectors, error envelopes, shared UI

## Repository layer (`backend/src/repositories/`)
Persistence is behind `RoleRepository`, `UserRoleRepository` and `PermissionAuditRepository`,
built from a `PrismaLike` structural type (`createRepositories(prisma)`). `RoleService` and
`PermissionGuard` no longer call Prisma directly; both accept an optional `Repositories` argument
for tests and default to `createRepositories(prisma)`. Multi-step writes (role deletion with
reassignment) are one repository method inside a transaction.

## Fraud detector pipeline (`backend/fraud/domain/detectors/`)
`FraudDetector` is the plug-in contract (async allowed, `id`, `weight`, `category`, optional `timeoutMs`).
`DetectorPipeline` runs enabled detectors concurrently, isolates thrown errors, timeouts and
out-of-range results (reported in `failures`, never aborting the evaluation), and reports every run
to a `DetectorObserver` (`createLoggingObserver` provided). Score maths lives in
`aggregation.ts`, shared with the legacy `Scorer`, and a test pins parity between the two.
Existing `FraudRule`s plug in through `ruleToDetector(rule)`.

## Error envelope (`backend/src/middleware/errorEnvelope.ts`, `sdks/*`)
```json
{ "success": false,
  "error": { "code": "NOT_FOUND", "message": "...", "details": { "field": "reason" } },
  "meta":  { "timestamp": "...", "requestId": "...", "apiVersion": 1 } }
```
- REST: `AppError`, `sendError`, `errorEnvelopeHandler` (masks 5xx messages), `notFoundEnvelopeHandler`.
  The idempotency middleware now returns this shape (previously `{ "error": "text" }`).
- Workers: `WorkerJobError` / `serializeWorkerError` produce `{ code, message, retryable, details }`,
  convertible with `workerErrorToEnvelope`.
- SDKs (JS, Python, Go) parse the envelope and still accept the legacy `{message, code}` and
  `{error: "text"}` bodies. Errors expose `requestId`, `details` and `retryable`. The Python SDK
  now raises `ApiError`/`AuthenticationError` instead of `requests.HTTPError`.

## Shared UI package (`packages/ui`, `@subtrackr/ui`)
`Card`, `EmptyState` and the design tokens (`spacing`, `borderRadius`, `typography`, `shadows`) moved
here. The app re-exports them from their old paths, and `src/utils/constants.ts` re-exports the tokens.
The package reads colours through `configureUI({ useColors })`; the app wires its theme in
`src/ui/configure.ts`. Storybook indexes `packages/ui/src/**/*.stories.tsx`.
