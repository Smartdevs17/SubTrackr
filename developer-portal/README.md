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
- Keys shown only once after creation
- Secure storage with masked display
- Permission-based access control (Read, Write, Delete, Admin)
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
- `developerPortalService.ts` - Developer profile and onboarding
- `apiKeyService.ts` - API key CRUD operations
- `usageTrackingService.ts` - Usage metrics and analytics

### Data Models
- `DeveloperProfile` - Developer account information
- `ApiKey` - API key with permissions and limits
- `UsageRecord` - Individual API request record
- `UsageStats` - Aggregated usage statistics
- `OnboardingStep` - Onboarding progress tracking
- `DocumentationSection` - API documentation content
- `IntegrationGuide` - Step-by-step integration guides

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
