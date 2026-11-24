# Secret Rotation Runbook

> Automated provider secret rotation with zero-downtime key swap.
> Part of the SubTrackr hardening program (Issue #2275).

---

## Overview

This runbook documents the procedure for rotating provider secrets (API keys, webhook secrets, OAuth tokens, etc.) across all integrated services. The rotation service (`backend/src/services/rotation.ts`) automates the full lifecycle:

```
PENDING → GENERATING → VALIDATING → PROMOTING → DEPRECATING → COMPLETED
                ↓ (on failure)
             ROLLED_BACK
```

---

## Prerequisites

- Access to provider dashboards (Stripe, PayPal, GitHub, OpenAI, etc.)
- `backend/src/services/rotation.ts` deployed and configured
- Monitoring alerts for `subtrackr.rotation.*` metrics
- On-call engineer with `approveRotation` permission

---

## Architecture

### Components

| Component | Responsibility |
|-----------|----------------|
| `SecretStore` | Persists secret metadata (keyId, version, timestamps) |
| `SecretGenerator` | Calls provider API to create new credentials |
| `SecretValidator` | Verifies new credentials work before promotion |
| `SecretPromoter` | Swaps active credential in provider config |
| `SecretRotationService` | Orchestrates the full rotation pipeline |

### Default Policy

```typescript
const DEFAULT_POLICY = {
  rotationIntervalMs: 90 days,    // Scheduled rotation
  maxAgeMs: 120 days,             // Forced rotation
  gracePeriodMs: 24 hours,        // Overlap period
  requireApproval: true,          // Manual gate
  rotationWindow: undefined,      // Any time
};
```

---

## Provider Configurations

### Stripe (`stripe`)

| Secret Type | Rotation Method | Validation |
|-------------|-----------------|------------|
| `api_key` | Stripe API: `POST /v1/api_keys` | Create test charge |
| `webhook_secret` | Stripe Dashboard → Webhooks | Verify signature |
| `client_secret` | Stripe Connect | OAuth flow test |

**Generator**: Creates restricted key with `payments` + `webhook_endpoints` permissions.
**Validator**: Attempts `POST /v1/charges` with `amount=100,currency=usd` (captured immediately).
**Promoter**: Updates webhook endpoint signing secret; revokes old key after grace period.

### PayPal (`paypal`)

| Secret Type | Rotation Method | Validation |
|-------------|-----------------|------------|
| `api_key` | PayPal Developer Dashboard | Create order + capture |
| `webhook_secret` | PayPal Developer → Webhooks | Verify webhook signature |
| `client_secret` | PayPal Apps | OAuth token exchange |

**Generator**: Creates new `client_id`/`secret` pair via Developer API.
**Validator**: Executes sandbox order flow.
**Promoter**: Updates webhook signing certificate; deactivates old app credentials.

### GitHub (`github`)

| Secret Type | Rotation Method | Validation |
|-------------|-----------------|------------|
| `api_key` (PAT) | GitHub Settings → Developer settings | `GET /user` |
| `webhook_secret` | GitHub Repo → Settings → Webhooks | Ping webhook |
| `oauth_token` | GitHub OAuth App | `GET /applications/:client_id/token` |

**Generator**: Creates fine-grained PAT with `repo`, `admin:repo_hook`, `workflow` scopes.
**Validator**: Calls `GET /user` and verifies scopes.
**Promoter**: Updates webhook secret in all tracked repos; revokes old PAT.

### OpenAI (`openai`)

| Secret Type | Rotation Method | Validation |
|-------------|-----------------|------------|
| `api_key` | OpenAI Platform → API Keys | `GET /models` |

**Generator**: Creates new secret key with `model` permissions.
**Validator**: Lists models to verify key works.
**Promoter**: Updates all service configs; revokes old key.

### Anthropic (`anthropic`)

| Secret Type | Rotation Method | Validation |
|-------------|-----------------|------------|
| `api_key` | Anthropic Console → API Keys | `GET /v1/models` |

### Slack (`slack`)

| Secret Type | Rotation Method | Validation |
|-------------|-----------------|------------|
| `webhook_secret` | Slack App → Incoming Webhooks | Post test message |
| `oauth_token` | Slack App → OAuth & Permissions | `auth.test` |

### SendGrid (`sendgrid`)

| Secret Type | Rotation Method | Validation |
|-------------|-----------------|------------|
| `api_key` | SendGrid Settings → API Keys | `GET /v3/user/profile` |

### Twilio (`twilio`)

| Secret Type | Rotation Method | Validation |
|-------------|-----------------|------------|
| `api_key` | Twilio Console → API Keys | `GET /2010-04-01/Accounts/{Sid}` |
| `webhook_secret` | Twilio Console → Webhooks | Validate signature |

### Cloud Providers (AWS/GCP/Azure)

| Provider | Secret Type | Rotation Method |
|----------|-------------|-----------------|
| AWS | `api_key` (Access Key) | IAM → Create Access Key |
| AWS | `webhook_secret` | API Gateway → Custom Authorizer |
| GCP | `api_key` (Service Account Key) | IAM → Create Key |
| Azure | `api_key` (Client Secret) | App Registration → Certificates & Secrets |

---

## Operational Procedures

### 1. Scheduled Rotation (Automatic)

The service runs on a cron schedule (default: daily at 03:00 UTC) and checks all providers against their policies.

```bash
# Trigger manual check
curl -X POST http://localhost:3000/admin/rotation/check \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### 2. Manual Rotation (Emergency)

```bash
# Rotate specific secret immediately (skips approval & grace period)
curl -X POST http://localhost:3000/admin/rotation/rotate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"stripe","type":"api_key"}'

# Response
{
  "success": true,
  "jobId": "rot_stripe_api_key_1700000000_abc123",
  "newKeyId": "sk_live_new...",
  "oldKeyId": "sk_live_old..."
}
```

### 3. Approved Rotation (Standard)

```bash
# 1. Start rotation (enters pending state)
curl -X POST http://localhost:3000/admin/rotation/start \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"paypal","type":"webhook_secret"}'

# Response: { "jobId": "rot_paypal_webhook_secret_1700000000_xyz789" }

# 2. Review job details
curl http://localhost:3000/admin/rotation/jobs/rot_paypal_webhook_secret_1700000000_xyz789

# 3. Approve (requires admin role)
curl -X POST http://localhost:3000/admin/rotation/approve/rot_paypal_webhook_secret_1700000000_xyz789 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"approver":"oncall-engineer"}'
```

### 4. Check Job Status

```bash
# List all jobs
curl http://localhost:3000/admin/rotation/jobs

# Filter by provider
curl "http://localhost:3000/admin/rotation/jobs?provider=stripe"

# Filter by phase
curl "http://localhost:3000/admin/rotation/jobs?phase=pending"
```

---

## Monitoring & Alerting

### Key Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `subtrackr.rotation.jobs.started` | Rotations initiated | — |
| `subtrackr.rotation.completed` | Successful rotations | < 1 per 90d per provider |
| `subtrackr.rotation.failed` | Failed rotations | > 0 (immediate) |
| `subtrackr.rotation.rolled_back` | Rollbacks executed | > 0 (immediate) |
| `subtrackr.rotation.approved` | Approvals granted | — |
| `subtrackr.rotation.duration` | End-to-end latency | > 10 min (warning) |

### Dashboards

- **Grafana**: `SubTrackr / Secret Rotation` dashboard
- **Key panels**: Success rate, duration histogram, pending approvals count

### Alerts

| Alert | Condition | Severity | Runbook |
|-------|-----------|----------|---------|
| `RotationFailed` | `subtrackr.rotation.failed > 0` | Critical | This runbook §5 |
| `RotationRolledBack` | `subtrackr.rotation.rolled_back > 0` | Critical | This runbook §6 |
| `RotationStuckPending` | Jobs in `pending` > 24h | Warning | §4.2 |
| `SecretExpiringSoon` | Any secret age > 100 days | Warning | §4.1 |

---

## Failure Scenarios & Recovery

### 5.1 Generation Failed (`GENERATION_FAILED`)

**Symptoms**: Job stuck in `generating`, error in logs.
**Causes**: Provider API rate limit, invalid permissions, network issue.
**Recovery**:
1. Check provider status page.
2. Verify service account permissions.
3. Retry: `POST /admin/rotation/rotate` with same params.
4. If persistent, escalate to provider support.

### 5.2 Validation Failed (`VALIDATION_FAILED`)

**Symptoms**: Job in `failed`, phase was `validating`.
**Causes**: Generated secret malformed, provider API changed, wrong scopes.
**Recovery**:
1. Check validation logs for details.
2. Manually test generated credentials against provider API.
3. Update `SecretValidator` if provider API changed.
3. Retry rotation.

### 5.3 Promotion Failed (`PROMOTION_FAILED`)

**Symptoms**: Job in `failed`, phase was `promoting`.
**Causes**: Webhook endpoint update failed, config propagation delay, permission denied.
**Recovery**:
1. Check promoter logs for specific endpoint errors.
2. Manually verify old credentials still work.
3. If old credentials valid, system auto-rolls back.
4. Fix promoter implementation, retry.

### 5.4 Rollback Executed (`ROLLED_BACK`)

**Symptoms**: Job in `rolled_back`, metrics show rollback.
**Causes**: Any failure after `promoting` phase.
**Recovery**:
1. Verify old credentials are active and working.
2. Check rollback logs for errors.
3. If rollback failed (`rollback_failed` metric), manual intervention needed:
   - Restore old credentials in provider dashboard.
   - Update service configs manually.
4. Post-incident review required.

### 5.5 Approval Timeout

**Symptoms**: Job stuck in `pending` > 24h.
**Recovery**:
1. Notify on-call engineer.
2. If no longer needed, job expires automatically (TTL: 7 days).
3. If still needed, approve manually.

---

## Testing

### Unit Tests

```bash
# Run rotation service tests
npx jest backend/src/services/__tests__/rotation.test.ts
```

### Integration Tests

```bash
# Test against staging providers
npm run test:rotation:staging
```

### Chaos Testing

```bash
# Simulate provider API failures
npx jest backend/src/services/__tests__/rotation.chaos.test.ts
```

---

## Rollback Procedure (Manual)

If automated rollback fails:

1. **Identify affected services** — check which services use the rotated secret.
2. **Restore old credentials** in provider dashboard.
3. **Update service configs** — deploy old secret value to all services.
4. **Verify** — run health checks on all affected services.
5. **Mark job as rolled back** in rotation service.

```bash
# Emergency revert
curl -X POST http://localhost:3000/admin/rotation/emergency-revert \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"jobId":"rot_stripe_api_key_1700000000_abc123"}'
```

---

## Security Considerations

- **Secret values never logged** — only metadata (keyId, version, timestamps) stored.
- **Least privilege** — generated keys have minimal required scopes.
- **Audit trail** — every rotation creates immutable audit log entry.
- **Access control** — only `admin:rotation` role can approve/execute.
- **Encryption at rest** — secret metadata encrypted in database.

---

## References

- [Rotation Service Source](../backend/src/services/rotation.ts)
- [ADR 0003: Secret Rotation Strategy](../docs/adr/0003-secret-rotation.md)
- [Provider API Docs](https://subtrackr.internal/docs/providers)
- [Incident Response Runbook](incident-response.md)