# Navigation Architecture

## Overview

SubTrackr uses a feature-based modular navigation architecture built on React Navigation 6. The navigation is organized into feature-specific stack navigators, each handling a distinct domain of the application.

## Architecture

### Module Structure

```
src/navigation/
├── AppNavigator.tsx          # Main navigator with tab and stack configuration
├── types.ts                  # TypeScript types for routes and params
├── navigationRef.ts          # Typed navigation ref for external navigation
├── linking.ts                # Deep linking configuration
├── analytics.ts              # Navigation analytics tracking
├── benchmark.ts              # Navigation performance benchmarks
├── NavigationErrorBoundary.tsx  # Error boundary for navigation
└── modules/
    ├── SubscriptionStack.tsx # Subscription management screens
    ├── AnalyticsStack.tsx    # Analytics and reporting screens
    ├── SettingsStack.tsx     # Settings and preferences screens
    ├── AdminStack.tsx        # Admin dashboard screens
    ├── WalletStack.tsx       # Wallet and invoice screens
    ├── DeveloperStack.tsx    # Developer tools screens
    └── SocialStack.tsx       # Community and social features
```

### Feature Modules

| Module | Purpose | Screens |
|--------|---------|---------|
| SubscriptionStack | Subscription lifecycle | Add, Detail, Edit, Change Plan, Cancel, Pause, Usage |
| AnalyticsStack | Analytics & reporting | Analytics, Revenue, Performance, Churn |
| SettingsStack | App settings | Settings, Language, Notifications, Privacy, Tax |
| AdminStack | Admin operations | Dashboard, Merchants, Fraud, Billing, SLA |
| WalletStack | Payments & invoices | Wallet, Crypto, Invoices, Payments, Calendar |
| DeveloperStack | Developer tools | Portal, Sandbox, API Keys, Docs, Webhooks |
| SocialStack | Community features | Community, Profile, Gamification, Loyalty, Groups |

### Tab Navigator

The bottom tab navigator provides 6 primary entry points:

1. **HomeTab** - HomeStack with subscription management
2. **AddTab** - Quick add subscription
3. **WalletTab** - Wallet and payment management
4. **AnalyticsTab** - Analytics dashboard
5. **RevenueTab** - Revenue reporting
6. **SettingsTab** - Settings and admin

## Lazy Loading

All screens except the Home screen use lazy loading via `dynamic import()` wrapped in `lazyScreen()`. This ensures:

- Faster initial load time
- Reduced memory footprint
- Code splitting per feature module

```typescript
const SubscriptionDetailScreen = lazyScreen(
  () => import('../screens/SubscriptionDetailScreen')
);
```

## Feature Gating

Routes can be gated by feature flags and subscription tiers:

```typescript
const routeFeatureMap: Partial<Record<keyof RootStackParamList, FeatureId>> = {
  CryptoPayment: FeatureId.CRYPTO_INTEGRATION,
  Analytics: FeatureId.ADVANCED_ANALYTICS,
};
```

## Auth Gating

Protected routes require authentication:

```typescript
const authRequiredRoutes: Set<keyof RootStackParamList> = new Set([
  'Profile',
  'AdminDashboard',
  'MerchantOnboarding',
]);
```

## Deep Linking

The app supports deep linking with URL prefixes:
- `subtrackr://`
- `https://subtrackr.app`

### URL Patterns

| Pattern | Route |
|---------|-------|
| `/home` | HomeTab |
| `/subscriptions/:id` | SubscriptionDetail |
| `/settings/admin` | AdminDashboard |
| `/wallet/connect` | WalletConnect |
| `/analytics` | AnalyticsTab |

## Error Handling

The `NavigationErrorBoundary` component catches navigation errors and provides a graceful fallback UI with retry capability.

## Analytics

Navigation analytics track:
- Screen views with previous screen context
- Navigation actions
- Navigation errors
- Deep link usage
- Screen render performance

## Performance Benchmarks

Target metrics:
- Screen render: < 250ms (p95)
- Navigation transition: < 300ms
- Deep link resolution: < 500ms
- Tab bar response: < 100ms

## Testing

Navigation tests verify:
- Analytics event tracking
- Screen metric calculations
- Navigation path building
- Event limits and clearing

## Adding a New Screen

1. Create the screen component in `src/screens/`
2. Add route to `RootStackParamList` in `types.ts`
3. Add lazy import in the appropriate module stack
4. Register in `AppNavigator.tsx` if needed for direct access
5. Add deep link path in `linking.ts` if applicable
6. Add feature gate if tier-restricted
