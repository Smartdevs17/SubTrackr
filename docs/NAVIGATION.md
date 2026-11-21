# Navigation Architecture

## Overview

SubTrackr uses a feature-based modular navigation architecture built on React Navigation 6. Each feature domain owns its own typed stack navigator param list. A `RootStackParamList` intersection type provides backward compatibility for screens that have not yet been migrated to a specific stack type.

## File layout

```
src/navigation/
├── AppNavigator.tsx            # Root navigator wiring tabs and stacks
├── types.ts                    # All param list types and typed hook helpers
├── navigationRef.ts            # Typed nav ref + per-stack navigate helpers
├── linking.ts                  # Deep linking configuration
├── analytics.ts                # Navigation analytics tracking
├── NavigationErrorBoundary.tsx # Error boundary for navigation failures
└── modules/
    ├── index.ts
    ├── SubscriptionStack.tsx
    ├── AnalyticsStack.tsx
    ├── SettingsStack.tsx
    ├── AdminStack.tsx
    ├── WalletStack.tsx
    ├── DeveloperStack.tsx
    └── SocialStack.tsx
```

## Type map

`types.ts` exports the following types. Import the narrowest type that fits your use-case.

### Per-stack param lists

Each module stack declares its own param list. TypeScript enforces that only routes registered in that navigator are reachable from code that navigates within it.

| Type | Navigator | Key screens |
|------|-----------|-------------|
| `SubscriptionStackParamList` | `SubscriptionStack` | SubscriptionDashboard, AddSubscription, SubscriptionDetail `{id}`, EditSubscription `{id}`, ChangePlan `{subscriptionId}`, CancellationFlow `{subscriptionId}`, PauseSubscription, UsageDashboard, UsageAlerts, PlanTemplates |
| `AnalyticsStackParamList` | `AnalyticsStack` | Analytics, AnalyticsDashboard, RevenueReport, PerformanceDashboard, ChurnPrediction, ForecastingDashboard |
| `SettingsStackParamList` | `SettingsStack` | Settings, LanguageSettings, NotificationPreferences, DeliveryStatus, NotificationInbox, EmailTemplateEditor, TemplateVersionHistory `{type, channel}`, GDPRSettings, PrivacyCenter, ConsentManagement, SmsConsent, DataExport, DPALog, TaxSettings, TaxCompliance, AdvancedSearch |
| `WalletStackParamList` | `WalletStack` | WalletConnect, CryptoPayment, InvoiceList, InvoiceDetail `{id}`, InvoiceCustomization, InvoiceMarketplace, InvoiceAnalytics, PaymentMethods, CalendarIntegration |
| `AdminStackParamList` | `AdminStack` | AdminDashboard, MerchantOnboarding, FraudDashboard, ErrorDashboard, SlaDashboard, BillingSettings, BillingAlignment, DunningDashboard, CreditsAndPrepayments, SessionManagement, RoleManagement, CustomerHealth |
| `DeveloperStackParamList` | `DeveloperStack` | DeveloperPortal, ApiPlayground, SandboxDashboard, ApiKeyManagement, ApiKeys, DocumentationPortal, IntegrationGuides, WebhookSettings, WebhookLogs, Import, Export, BatchOperations, AccountingExport |
| `SocialStackParamList` | `SocialStack` | Community, Profile, Gamification, LoyaltyDashboard, AffiliateDashboard, CampaignManagement, PromotionManagement, SegmentManagement, SegmentDetail `{segmentId}`, GroupManagement, SupportDashboard, TrialDetails, NotFound |

### Composite types

| Type | Purpose |
|------|---------|
| `RootStackParamList` | Intersection of all per-stack lists. Used by `useAppRoute` / `useAppNavigation` and by any screen that spans multiple stacks. Prefer the specific stack type where possible. |
| `TabParamList` | Bottom-tab navigator: `HomeTab`, `WalletTab`, `AnalyticsTab`, `SettingsTab`. |
| `RootNavigatorParamList` | Root native-stack navigator: `MainTabs` plus the four named stacks for modal/full-screen presentation. |

### Parametric routes

| Route | Required params |
|-------|----------------|
| `SubscriptionDetail` | `{ id: string }` |
| `EditSubscription` | `{ id: string }` |
| `ChangePlan` | `{ subscriptionId: string }` |
| `CancellationFlow` | `{ subscriptionId: string }` |
| `InvoiceDetail` | `{ id: string }` |
| `SegmentDetail` | `{ segmentId: string }` |
| `TemplateVersionHistory` | `{ type: NotificationType; channel: NotificationChannel }` |
| `SmsConsent` | `{ userId?: string } \| undefined` |
| `CryptoPayment` | `{ subscriptionId?: string } \| undefined` |
| `Profile` | `{ subscriber?: string } \| undefined` |
| `NotFound` | `{ reason?: string }` |

## Typed hook helpers

```typescript
import { useAppRoute, useAppNavigation } from '../navigation/types';

// Inside any screen component:
const route = useAppRoute<'SubscriptionDetail'>();
// route.params.id  →  string ✓

const navigation = useAppNavigation<'SubscriptionDetail'>();
// navigation.navigate('EditSubscription', { id: route.params.id }) ✓
```

When you know exactly which stack a screen lives in, prefer the stack-specific type:

```typescript
import type { SubscriptionStackParamList } from '../navigation/types';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

const navigation =
  useNavigation<NativeStackNavigationProp<SubscriptionStackParamList, 'SubscriptionDetail'>>();
```

## Out-of-component navigation

`navigationRef.ts` exports helpers for navigating from outside React components (push notification handlers, background services, etc.).

```typescript
import {
  navigateSubscription,
  navigateSettings,
  navigateWallet,
  navigateAnalytics,
} from '../navigation/navigationRef';

navigateSubscription('SubscriptionDetail', { id: 'sub-123' });
navigateSettings('NotificationPreferences');
navigateWallet('InvoiceDetail', { id: 'inv-7' });
navigateAnalytics('RevenueReport');
```

Each helper guards on `navigationRef.isReady()` and routes into the correct tab so the user lands with a coherent back-stack.

The deprecated `navigateHomeScreen` and `navigateSettingsScreen` aliases are still present. Migrate call sites to `navigateSubscription` and `navigateSettings` respectively; the aliases will be removed in a future wave.

## Lazy loading

All screens use `lazyScreen()` from `src/utils/lazyLoading`. Frequently accessed routes are warmed in `AppNavigator.tsx` via `prefetchModule()` after first paint:

```typescript
prefetchModule('AddSubscription', () => import('../screens/AddSubscriptionScreen'));
prefetchModule('WalletConnect',   () => import('../screens/WalletConnectV2Screen'));
```

Keep the prefetch list short — only routes that users commonly open in the first session.

## Deep linking

| URL | Route |
|-----|-------|
| `subtrackr:///` | HomeTab → SubscriptionDashboard |
| `subtrackr:///subscription/add` | AddSubscription |
| `subtrackr:///subscription/:id` | SubscriptionDetail |
| `subtrackr:///settings` | Settings |

Add new paths in `linking.ts`. Use the `parse` option to coerce query-string values to the right type:

```typescript
AddSubscription: {
  path: 'subscription/add',
  parse: { amount: (v: string) => parseFloat(v) },
},
```

## Adding a new screen

1. Create the screen component in `src/screens/`.
2. Add its route name and params to the **specific per-stack param list** in `types.ts`. Only add to `RootStackParamList` if the screen is legitimately reachable from multiple stacks.
3. Add a `lazyScreen()` import and a `<Stack.Screen>` entry in the matching `modules/*.tsx` file.
4. If the screen needs a deep link, add it to `linking.ts`.
5. If the screen is feature-gated, register it in the feature map in `AppNavigator.tsx`.

## Testing

```bash
# Type and ref tests (pure TS, no React Native preset):
npx jest --config jest.backend.config.js \
  --testPathPattern 'src/navigation/__tests__/navigationTypes'

npx jest --config jest.backend.config.js \
  --testPathPattern 'src/navigation/__tests__/navigationRef'

# Analytics tests:
npx jest --config jest.backend.config.js \
  --testPathPattern 'src/navigation/__tests__/navigationAnalytics'
```

Tests live in `src/navigation/__tests__/` and cover:

- Per-stack param list shapes (route counts and key names).
- `RootStackParamList` intersection — one representative route from every stack.
- Typed param objects for every parametric route.
- `useAppRoute` and `useAppNavigation` delegation.
- All `navigateRef` helpers: ready/not-ready guard, correct tab targeting, nested screen params passed through.
- Navigation analytics tracking, screen metrics, navigation path, and event-count limits.

## Performance targets

| Metric | Target |
|--------|--------|
| Screen render | < 250 ms p95 |
| Navigation transition | < 300 ms |
| Deep link resolution | < 500 ms |
| Tab bar response | < 100 ms |
