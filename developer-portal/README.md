# Developer Portal

A comprehensive developer portal for SubTrackr with API key management, interactive documentation, usage analytics, and testing tools.

## Features

### ✅ API Key Management
- Generate API keys with custom permissions and scoping
- Configure rate limits (requests per minute/day)
- Set expiration dates or create never-expiring keys
- Revoke, rotate, and delete API keys
- View key usage statistics and last used timestamps
- Secure key display with masking
- Best practices guidance for key security

### ✅ Interactive API Documentation
- Searchable documentation with category filtering
- Complete API reference with examples
- Integration guides for multiple languages
- Tag-based navigation
- Quick access to API tester and SDK downloads

### ✅ API Testing Tool (Try-It-Now)
- Interactive endpoint testing with live requests
- Support for all HTTP methods (GET, POST, PUT, DELETE, PATCH)
- API key selection for authenticated requests
- Request body and headers customization
- Real-time response display with status codes
- Response time measurement
- Example endpoints for quick testing

### ✅ Usage Analytics
- Total requests, success rate, and error rate metrics
- Request trend charts (7/30/90 day views)
- Top endpoints by request volume
- Top errors with occurrence counts
- Recent request history with details
- Rate limit monitoring and visualization
- Response time analytics

### ✅ Webhook Testing Tool
- Configure webhook URLs and event subscriptions
- Test webhook delivery with custom payloads
- Generate webhook secrets for signature verification
- Support for multiple event types:
  - subscription.created
  - subscription.updated
  - subscription.cancelled
  - payment.succeeded
  - payment.failed
  - invoice.created
  - invoice.paid
- Signature verification option
- Best practices for webhook implementation

### ✅ SDK Downloads & Quickstart
- Official SDKs for 6+ programming languages:
  - Node.js / TypeScript
  - Python
  - Ruby
  - PHP
  - Go
  - Java
- Installation commands with copy-to-clipboard
- Feature highlights for each SDK
- Quickstart code examples
- Links to documentation and GitHub repositories
- Community SDK information

### ✅ Developer Onboarding
- Step-by-step onboarding process
- Progress tracking with completion percentage
- Required and optional steps
- Guided setup for first API key
- Documentation exploration prompts

### ✅ Dashboard Overview
- Quick stats: API keys, calls, success rate, response time
- Usage trend visualization
- Recent activity feed
- Quick action cards for common tasks
- Onboarding progress indicator
- Resource links and guides

## Security Features

### 🔒 API Key Security
- Keys shown only once after creation; only a SHA-256 hash is stored
- Cryptographically random secrets with masked display
- Scoped permissions (`resource:read` / `resource:write`) limited by tier
- Optional IPv4 / CIDR allowlist per key
- Rate limiting to prevent abuse
- Expiration dates for temporary access
- Revocation and rotation capabilities

### 🔒 Client-Side Protection
- Warning against exposing keys in client code
- Environment variable recommendations
- Best practices documentation
- Security alerts and tips

## Technical Implementation

### Architecture
```
developer-portal/
├── actions/                          # Typed server actions (issue #2061)
│   ├── index.ts                      # Barrel export
│   ├── result.ts                     # ActionResult discriminated union
│   ├── schemas.ts                    # Zod input validation schemas
│   ├── observability.ts              # Logger, metrics, withAction wrapper
│   ├── developerActions.ts           # Register, verify, onboarding, get, update
│   ├── apiKeyActions.ts              # Create, revoke, rotate, list
│   ├── usageActions.ts               # GetMetrics, trackUsage
│   ├── dashboardActions.ts           # GetDashboard
│   └── documentationActions.ts       # GetDocs, search, getArticle, guides
├── src/
│   ├── screens/
│   │   ├── DeveloperPortalScreen.tsx      # Main dashboard
│   │   ├── ApiKeyManagementScreen.tsx     # Key management
│   │   ├── ApiDocumentationScreen.tsx     # Documentation browser
│   │   ├── ApiTesterScreen.tsx            # Interactive API tester
│   │   ├── WebhookTesterScreen.tsx        # Webhook testing
│   │   ├── UsageAnalyticsScreen.tsx       # Usage analytics
│   │   └── SdkDownloadScreen.tsx          # SDK downloads
│   └── components/
│       ├── DashboardCard.tsx              # Stat cards
│       ├── QuickActionCard.tsx            # Action buttons
│       ├── OnboardingProgress.tsx         # Progress indicator
│       ├── UsageChart.tsx                 # Usage visualization
│       ├── RecentActivity.tsx             # Activity feed
│       ├── ApiKeyCard.tsx                 # Key display
│       ├── PermissionSelector.tsx         # Permission picker
│       └── RateLimitConfig.tsx            # Rate limit settings
```

### State Management
- Zustand store (`developerPortalStore.ts`)
- Centralized state for developer profile, API keys, usage stats
- Async actions for data fetching and mutations
- Error handling with user-friendly messages

### Services
- `developerPortalService.ts` - DeveloperLifecycleService: registration, onboarding, API keys, usage tracking, dashboard
- `portalService.ts` - PortalDashboardService: portal users and dashboard view
- `apiKeyRotationService.ts` - PortalApiKeyRotationService: key rotation with grace period
- `documentationService.ts` - DocumentationService: article CRUD, search, sections
- `integrationGuidesService.ts` - IntegrationGuidesService: integration guide CRUD

### Typed Server Actions (issue #2061)

All portal data fetching and mutations go through typed server actions in
`actions/`. Each action:

1. **Validates input** with a Zod schema (`actions/schemas.ts`).
2. **Returns a discriminated union** `ActionResult<T>` — `{ ok: true; data: T }`
   or `{ ok: false; error: { code, message, fieldErrors? } }` — so callers
   narrow on `ok` without try/catch.
3. **Records observability** via the `withAction` wrapper: structured logs,
   metrics counters, and Prometheus export.

#### Available actions

| Action | Input | Returns |
|--------|-------|---------|
| `registerDeveloperAction` | `{ email, name, company? }` | `Developer` |
| `verifyEmailAction` | `{ developerId, token }` | `{ verified }` |
| `completeOnboardingAction` | `{ developerId }` | `Developer` |
| `getDeveloperAction` | `{ developerId }` | `Developer` |
| `updateDeveloperAction` | `{ developerId, name?, tier?, ... }` | `Developer` |
| `createApiKeyAction` | `{ developerId, name, type, permissions }` | `ApiKey` |
| `revokeApiKeyAction` | `{ developerId, apiKeyId }` | `{ revoked }` |
| `rotateApiKeyAction` | `{ apiKeyId, gracePeriodMs?, reason? }` | rotation result |
| `getApiKeysAction` | `{ developerId }` | `ApiKey[]` |
| `getUsageMetricsAction` | `{ developerId }` | `UsageMetrics` |
| `trackUsageAction` | `{ developerId, endpoint, method, responseTime, success }` | `{ tracked }` |
| `getDashboardAction` | `{ developerId }` | `DeveloperDashboard` |
| `getDocumentationAction` | `{ category? }` | `Documentation[]` |
| `getDocumentationSectionsAction` | — | `DocumentationSection[]` |
| `getArticleAction` | `{ slug }` | `DocumentationArticle` |
| `searchDocumentationAction` | `{ query }` | `DocumentationArticle[]` |
| `getIntegrationGuidesAction` | `{ platform? }` | `IntegrationGuide[]` |
| `getIntegrationGuideAction` | `{ guideId }` | `IntegrationGuide` |

#### Usage

```typescript
import { createApiKeyAction } from '../actions';

const result = await createApiKeyAction({
  developerId: 'dev_123',
  name: 'Production Key',
  type: 'production',
  permissions: ['subscriptions:read', 'subscriptions:write'],
});

if (result.ok) {
  console.log(result.data.key); // sk_live_...
} else {
  // result.error.code === 'validation_error' | 'not_found' | ...
  console.log(result.error.message);
}
```

#### Error codes

| Code | Meaning |
|------|---------|
| `validation_error` | Input failed Zod validation; `fieldErrors` has details. |
| `not_found` | Referenced entity (developer, key, guide…) does not exist. |
| `conflict` | Business rule violation (e.g. duplicate email). |
| `internal_error` | Unexpected error inside the action body. |

#### Observability

The `withAction` wrapper in `actions/observability.ts` wires three signals:

- **Logs**: `portalLogger` (child of the backend structured logger) emits
  JSON-structured lines at action start, success, failure, and error, with
  duration and error codes. PII is automatically redacted.
- **Metrics**: `portalMetrics.record()` tracks total, success, and failure
  counts plus cumulative duration per action. Exported in Prometheus text
  format via `portalMetrics.toPrometheus()` and automatically registered with
  the backend's default `PrometheusMetricsExporter` (visible at `/metrics`).
- **Traces**: The backend logger uses `AsyncLocalStorage` for correlation ID
  propagation, so all log lines inside an action carry the request's
  correlation ID automatically.

### API Key Issuance and Scopes

`services/apiKeyIssuanceService.ts` issues keys, and `utils/apiKeyScopes.ts`
holds the rules. `developerPortalService.createApiKey` / `revokeApiKey` /
`getApiKeys` and `createApiKeyAction` all go through them.

- **Secrets:** each key is 32 random bytes from `crypto`, prefixed `sk_test_`
  or `sk_live_`. Only a SHA-256 hash is stored. The plaintext comes back once,
  in `createApiKeyAction`'s `data.key`. Every listing shows a masked key, such
  as `sk_live_abcd…wxyz`.
- **Scopes:** `resource:action`, using the `ApiPermission` values. A `write`
  scope implies `read` on the same resource, and stored scopes include the
  implied ones.
- **Tier policy:**

  | Tier | Scopes | Active keys | Max lifetime (default) |
  |---|---|---|---|
  | free | all `:read`, `subscriptions:write`, `webhooks:write`, `sandbox:manage` | 3 | 90 days |
  | pro | all except `users:write` | 10 | 365 days |
  | enterprise | all | 50 | 365 days |

  Production keys need an `active` (verified) account and can't hold
  `sandbox:manage`.
- **IP allowlist:** an optional `ipAllowlist` of IPv4 addresses or CIDR
  ranges, stored on `ApiKey.ipWhitelist`.
- **Errors from `createApiKeyAction`:**

  | Problem | Error code |
  |---|---|
  | Plan or account doesn't allow the request | `forbidden` |
  | Active-key limit reached | `conflict` |
  | Malformed IP allowlist | `validation_error` |

  `fieldErrors` names each problem, with paths `permissions`, `type`,
  `expiresInDays` and `ipAllowlist`.
- **Request-time check:** an API gateway calls
  `apiKeyIssuanceService.authorize(secret, requiredScope, ip)` and gets either
  `{ allowed: true, developerId, apiKey }` or `{ allowed: false, reason }`.
  The reason is one of `invalid_key`, `revoked`, `expired`,
  `insufficient_scope` or `ip_not_allowed`. Usage is recorded on success.
- **Observability:** logs record `apiKey.issued`,
  `apiKey.issuance_rejected`, `apiKey.revoked` and
  `apiKey.authorization_denied` (secrets are never logged). Two Prometheus
  counters are registered with the default exporter:
  `developer_portal_api_keys_issued_total` / `_rejected_total` and
  `developer_portal_api_key_authorizations_total{result,reason}`.

### Data Models
- `Developer` - Developer account with onboarding status, API keys, usage, billing
- `ApiKey` - API key with permissions and rate limits
- `UsageMetrics` - Aggregated API request statistics
- `DeveloperDashboard` - Dashboard view with sandbox environments and activity
- `DocumentationSection` - API documentation content
- `IntegrationGuide` - Step-by-step integration guides
- `PortalUser` - Portal user profile

Types are consolidated in `types/index.ts` — the single canonical barrel that
resolves duplicate definitions between `portal.ts` and `developer.ts`.

## Edge Cases Handled

### ⚠️ API Key Exposure Prevention
- Keys never stored in plain text in client code
- Masked display by default (show/hide toggle)
- One-time display after creation with explicit warning
- Copy-to-clipboard functionality for secure transfer
- Environment variable usage recommendations

### ⚠️ Rate Limit Visualization
- Real-time rate limit usage display
- Visual progress bars for quota consumption
- Daily limit reset notifications
- Warning thresholds for approaching limits
- Per-key and account-level tracking

### ⚠️ Error Handling
- Network failure recovery
- Invalid API key detection
- Expired key handling
- Permission denied scenarios
- Rate limit exceeded responses
- Validation errors with helpful messages

### ⚠️ Edge Cases
- Empty states for no API keys
- No usage data scenarios
- Expired keys automatic detection
- Duplicate key name handling
- Invalid permission combinations
- Malformed webhook URLs
- Invalid JSON payloads

## Usage

### Creating an API Key
1. Navigate to API Key Management
2. Click "New Key"
3. Enter key name and select permissions
4. Configure rate limits (optional)
5. Set expiration (optional)
6. Click "Create"
7. Copy the key immediately (shown only once)

### Testing an API Endpoint
1. Navigate to API Tester
2. Select an API key
3. Choose HTTP method
4. Enter endpoint path
5. Add request body/headers (if needed)
6. Click "Send Request"
7. View response with status and timing

### Monitoring Usage
1. Navigate to Usage Analytics
2. Select time period (7/30/90 days)
3. View request trends and statistics
4. Check top endpoints and errors
5. Review recent request history
6. Monitor rate limit usage

### Testing Webhooks
1. Navigate to Webhook Tester
2. Enter webhook URL
3. Select event types to subscribe
4. Generate or enter webhook secret
5. Customize test payload
6. Click "Send Test Webhook"
7. Review delivery results

## Integration Examples

### Node.js
```typescript
import { SubTrackr } from '@subtrackr/sdk';

const client = new SubTrackr({
  apiKey: process.env.SUBTRACKR_API_KEY,
});

const subscriptions = await client.subscriptions.list();
```

### Python
```python
from subtrackr import SubTrackr

client = SubTrackr(api_key=os.environ["SUBTRACKR_API_KEY"])
subscriptions = client.subscriptions.list()
```

## Best Practices

### API Key Management
- ✅ Use environment variables for API keys
- ✅ Rotate keys every 90 days
- ✅ Use least privilege permissions
- ✅ Revoke unused keys immediately
- ✅ Monitor key usage regularly
- ❌ Never commit keys to version control
- ❌ Never expose keys in client-side code
- ❌ Never share keys in public channels

### Webhook Security
- ✅ Always verify webhook signatures
- ✅ Respond within 5 seconds
- ✅ Implement idempotency
- ✅ Use HTTPS endpoints only
- ✅ Log webhook events for debugging

### Rate Limiting
- ✅ Implement exponential backoff
- ✅ Cache responses when possible
- ✅ Monitor rate limit headers
- ✅ Upgrade tier if limits are insufficient

## Future Enhancements

- [ ] GraphQL API support
- [ ] Webhook event replay
- [ ] API versioning management
- [ ] Team collaboration features
- [ ] Custom rate limit rules
- [ ] Advanced analytics and insights
- [ ] API performance monitoring
- [ ] Automated testing suites
- [ ] Sandbox environment isolation
- [ ] Production deployment checklist

## Support

For questions or issues:
- 📖 [Documentation](https://docs.subtrackr.com)
- 💬 [Discord Community](https://discord.gg/subtrackr)
- 📧 [Email Support](mailto:support@subtrackr.com)
- 🐛 [GitHub Issues](https://github.com/subtrackr/issues)

## License

MIT License - see LICENSE file for details
