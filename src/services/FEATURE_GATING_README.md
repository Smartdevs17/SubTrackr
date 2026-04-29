# Feature Gating System Documentation

## Overview

The Feature Gating System provides subscription-based access control for SubTrackr features. It enables tier-based feature access, gradual rollouts, A/B testing, and feature dependencies.

## Architecture

### Core Components

#### 1. **Feature Flags Service** (`featureFlags.ts`)
The main service that handles all feature access logic.

```typescript
import { featureFlagsService } from '../services/featureFlags';

// Set user ID for rollout calculations
featureFlagsService.setUserId('user123');

// Check feature access
const result = await featureFlagsService.checkFeatureAccess(
  FeatureId.ADVANCED_ANALYTICS,
  SubscriptionTier.PREMIUM
);

if (result.hasAccess) {
  // Render feature
}
```

**Key Methods:**
- `checkFeatureAccess()` - Check if user can access a feature
- `getAvailableFeatures()` - Get all features for a tier
- `getFeature()` - Get feature details
- `getFeatureLimits()` - Get usage limits for a tier
- `hasExceededLimit()` - Check if usage limit is exceeded
- `getRemainingUsage()` - Get remaining usage for a limit

#### 2. **Feature Configuration** (`config/features.ts`)
Defines all features, their tiers, limits, and settings.

```typescript
export const FEATURE_CONFIG: FeatureConfig = {
  globalRolloutPercentage: 100,
  abTestEnabled: true,
  plans: {
    [SubscriptionTier.FREE]: [
      FeatureId.BASIC_SUBSCRIPTION_TRACKING,
      FeatureId.BASIC_ANALYTICS,
    ],
    [SubscriptionTier.PREMIUM]: [
      // ... premium features
    ],
  },
  features: {
    [FeatureId.ADVANCED_ANALYTICS]: {
      id: FeatureId.ADVANCED_ANALYTICS,
      name: 'Advanced Analytics',
      description: 'Detailed spending trends and insights',
      enabled: true,
      tierAccess: [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
      dependencies: [FeatureId.BASIC_ANALYTICS],
      rolloutPercentage: 100,
    },
    // ... more features
  },
};
```

#### 3. **React Hooks** (`hooks/useFeatureAccess.ts`)
Custom hooks for easy integration in React components.

```typescript
// Single feature access
const { hasAccess, reason, loading } = useFeatureAccess(FeatureId.CRYPTO_INTEGRATION);

// Multiple features
const { results, loading } = useMultipleFeatureAccess([
  FeatureId.ADVANCED_ANALYTICS,
  FeatureId.CRYPTO_INTEGRATION,
]);

// Available features for current tier
const availableFeatures = useAvailableFeatures();

// Feature limits
const { hasExceededLimit, getRemainingUsage } = useFeatureLimits();
```

#### 4. **UI Components**

##### FeatureGate Component
Conditionally renders content based on feature access.

```typescript
<FeatureGate 
  feature={FeatureId.CRYPTO_INTEGRATION}
  showUpgradePrompt={true}
  upgradeMessage="Upgrade to enable crypto payments"
>
  <CryptoPaymentComponent />
</FeatureGate>
```

##### FeatureLimitGate Component
Enforces usage limits on features.

```typescript
<FeatureLimitGate
  limitKey="max_subscriptions"
  currentUsage={subscriptionCount}
  showLimitMessage={true}
>
  <AddSubscriptionButton />
</FeatureLimitGate>
```

##### FeatureManagement Component
Admin dashboard for managing features.

```typescript
<FeatureManagement 
  onFeatureUpdate={(featureId, updates) => {
    // Handle feature updates
  }}
/>
```

##### SubscriptionPlans Component
Display available subscription plans.

```typescript
<SubscriptionPlans 
  showCurrentPlan={true}
  onSelectPlan={(plan) => {
    // Handle plan selection
  }}
/>
```

## Subscription Tiers

### FREE Tier
- **Price:** $0/month
- **Max Subscriptions:** 5
- **Max Categories:** 3
- **Features:**
  - Basic subscription tracking
  - Basic analytics
  - Push notifications

### BASIC Tier
- **Price:** $4.99/month
- **Max Subscriptions:** 25
- **Max Categories:** 8
- **Features:**
  - Budget alerts
  - Data export
  - All FREE features

### PREMIUM Tier
- **Price:** $9.99/month
- **Max Subscriptions:** 100
- **Max Categories:** 20
- **Features:**
  - Advanced analytics
  - Multi-currency support
  - Crypto integration
  - All BASIC features

### ENTERPRISE Tier
- **Price:** $29.99/month
- **Max Subscriptions:** Unlimited
- **Max Categories:** Unlimited
- **Features:**
  - Team collaboration
  - Custom reports
  - API access
  - Priority support
  - White label
  - All PREMIUM features

## Key Features

### 1. Tier-Based Access Control
Features are assigned to subscription tiers. Users can only access features their tier includes.

```typescript
const feature = FEATURE_CONFIG.features[FeatureId.ADVANCED_ANALYTICS];
// tierAccess: [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE]
```

### 2. Gradual Rollout
Roll out features to a percentage of users within a tier.

```typescript
const feature = {
  ...feature,
  rolloutPercentage: 50, // Only 50% of users get this feature
};
```

**How it works:**
- Uses deterministic hashing of user IDs
- Ensures consistent experience across sessions
- Prevents flicker when user reloads

### 3. A/B Testing
Test feature variations with different user groups.

```typescript
const feature = {
  ...feature,
  abTestGroups: ['control', 'variant_a', 'variant_b'],
};

// Get user's A/B test group
const { abTestGroup, isInAbTest } = await featureFlagsService.checkFeatureAccess(...);
```

**Storage:**
- A/B test assignments are persisted in AsyncStorage
- Consistent assignment across app restarts

### 4. Feature Dependencies
Features can depend on other features being available first.

```typescript
const feature = {
  id: FeatureId.CUSTOM_REPORTS,
  dependencies: [FeatureId.ADVANCED_ANALYTICS],
  // Users need ADVANCED_ANALYTICS to use CUSTOM_REPORTS
};
```

### 5. Usage Limits
Enforce per-tier limits on feature usage.

```typescript
const limits = featureFlagsService.getFeatureLimits(SubscriptionTier.FREE);
// { max_subscriptions: 5, max_categories: 3, export_formats: 1 }

const exceeded = featureFlagsService.hasExceededLimit(
  SubscriptionTier.FREE,
  'max_subscriptions',
  5 // current usage
);
```

## Usage Examples

### Example 1: Gating a Feature in a Screen
```typescript
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { FeatureGate } from '../components/common/FeatureGate';
import { FeatureId } from '../types/feature';

export const AnalyticsScreen = () => {
  return (
    <FeatureGate 
      feature={FeatureId.ADVANCED_ANALYTICS}
      fallback={<UpgradePrompt feature={FeatureId.ADVANCED_ANALYTICS} />}
    >
      <AdvancedAnalyticsPanel />
    </FeatureGate>
  );
};
```

### Example 2: Checking Multiple Features
```typescript
import { useMultipleFeatureAccess } from '../hooks/useFeatureAccess';

export const PaymentMethodsScreen = () => {
  const { results } = useMultipleFeatureAccess([
    FeatureId.MULTI_CURRENCY,
    FeatureId.CRYPTO_INTEGRATION,
  ]);

  return (
    <View>
      {results[FeatureId.MULTI_CURRENCY]?.hasAccess && (
        <MultiCurrencySelector />
      )}
      {results[FeatureId.CRYPTO_INTEGRATION]?.hasAccess && (
        <CryptoPaymentOption />
      )}
    </View>
  );
};
```

### Example 3: Enforcing Usage Limits
```typescript
import { useFeatureLimits } from '../hooks/useFeatureAccess';
import { FeatureLimitGate } from '../components/common/FeatureGate';

export const AddSubscriptionButton = () => {
  const { hasExceededLimit, getRemainingUsage } = useFeatureLimits();
  const subscriptionCount = useSubscriptionStore(s => s.subscriptions.length);

  if (hasExceededLimit('max_subscriptions', subscriptionCount)) {
    const remaining = getRemainingUsage('max_subscriptions', subscriptionCount);
    return (
      <View>
        <Text>Limit reached. Upgrade to add more subscriptions.</Text>
      </View>
    );
  }

  return (
    <FeatureLimitGate
      limitKey="max_subscriptions"
      currentUsage={subscriptionCount}
    >
      <TouchableOpacity onPress={handleAddSubscription}>
        <Text>Add Subscription</Text>
      </TouchableOpacity>
    </FeatureLimitGate>
  );
};
```

### Example 4: Admin Feature Management
```typescript
import { FeatureManagement } from '../components/admin/FeatureManagement';

export const AdminPanel = () => {
  const handleFeatureUpdate = (featureId, updates) => {
    // Update feature configuration
    // This could sync with a backend API
  };

  return (
    <FeatureManagement onFeatureUpdate={handleFeatureUpdate} />
  );
};
```

## Best Practices

### 1. Always Use Feature Gates for New Features
Wrap new features in FeatureGate components, even if all tiers initially have access.

```typescript
<FeatureGate feature={FeatureId.NEW_FEATURE}>
  <NewFeatureComponent />
</FeatureGate>
```

### 2. Provide Clear Upgrade Prompts
When a feature is not accessible, show users what they need to upgrade to.

```typescript
<FeatureGate
  feature={FeatureId.ADVANCED_ANALYTICS}
  upgradeMessage="Upgrade to Premium to access advanced analytics"
/>
```

### 3. Test with Different Tiers
During development, test your features with each subscription tier.

```typescript
// Test with FREE tier
useUserStore.setState({ subscriptionTier: SubscriptionTier.FREE });

// Test with PREMIUM tier
useUserStore.setState({ subscriptionTier: SubscriptionTier.PREMIUM });
```

### 4. Monitor Rollout Percentages
Start with low rollout percentages and gradually increase.

```typescript
// Day 1: 10% of premium users
rolloutPercentage: 10

// Day 3: 50% of premium users
rolloutPercentage: 50

// Day 7: 100% rollout
rolloutPercentage: 100
```

### 5. Set Up Dependencies Carefully
Document feature dependencies to prevent access issues.

```typescript
const dependencies = {
  [FeatureId.CUSTOM_REPORTS]: [FeatureId.ADVANCED_ANALYTICS],
  [FeatureId.ADVANCED_ANALYTICS]: [FeatureId.BASIC_ANALYTICS],
};
```

## Adding New Features

### Step 1: Add Feature ID
```typescript
// src/types/feature.ts
export enum FeatureId {
  // ... existing features
  NEW_FEATURE = 'new_feature',
}
```

### Step 2: Configure Feature
```typescript
// src/config/features.ts
[FeatureId.NEW_FEATURE]: {
  id: FeatureId.NEW_FEATURE,
  name: 'New Feature',
  description: 'Description of new feature',
  enabled: true,
  tierAccess: [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
  rolloutPercentage: 10, // Start with 10% rollout
  createdAt: new Date(),
  updatedAt: new Date(),
}
```

### Step 3: Add to Plans
```typescript
// src/config/features.ts
plans: {
  [SubscriptionTier.PREMIUM]: [
    // ... existing features
    FeatureId.NEW_FEATURE,
  ],
  // ...
}
```

### Step 4: Use in Components
```typescript
<FeatureGate feature={FeatureId.NEW_FEATURE}>
  <NewFeatureComponent />
</FeatureGate>
```

## Troubleshooting

### Feature Not Showing Up
1. Check if feature is enabled: `feature.enabled === true`
2. Verify user tier includes feature: `tierAccess.includes(userTier)`
3. Check rollout percentage: `rolloutPercentage >= 100` during testing
4. Check dependencies are met

### A/B Test Not Working
1. Ensure `abTestEnabled: true` in FEATURE_CONFIG
2. Verify A/B test groups are defined
3. Check AsyncStorage permissions
4. Verify user ID is set: `featureFlagsService.setUserId(userId)`

### Usage Limits Not Enforcing
1. Check limit key exists in `getFeatureLimits()`
2. Verify current usage calculation is accurate
3. Ensure FeatureLimitGate is wrapping the component
4. Check limit value is not -1 (unlimited)

## API Reference

### FeatureFlagsService

#### `setUserId(userId: string): void`
Set the current user ID for rollout and A/B test calculations.

#### `async checkFeatureAccess(featureId: FeatureId, userTier: SubscriptionTier, userId?: string): Promise<FeatureAccessResult>`
Check if a user has access to a feature.

**Returns:**
```typescript
{
  hasAccess: boolean;
  reason?: string;        // Why access was denied
  isInRollout?: boolean;   // Is user in gradual rollout
  isInAbTest?: boolean;    // Is user in A/B test
  abTestGroup?: string;    // A/B test group name
}
```

#### `getAvailableFeatures(userTier: SubscriptionTier): FeatureId[]`
Get all features available to a tier.

#### `getFeature(featureId: FeatureId): FeatureFlag | null`
Get feature details.

#### `getAllFeatures(): Record<string, FeatureFlag>`
Get all features.

#### `getFeatureLimits(userTier: SubscriptionTier): Record<string, number>`
Get usage limits for a tier. Returns -1 for unlimited.

#### `hasExceededLimit(userTier: SubscriptionTier, limitKey: string, currentUsage: number): boolean`
Check if a usage limit is exceeded.

#### `getRemainingUsage(userTier: SubscriptionTier, limitKey: string, currentUsage: number): number`
Get remaining usage before limit is hit. Returns -1 for unlimited.

## Related Files

- `src/services/featureFlags.ts` - Main service
- `src/config/features.ts` - Feature configuration
- `src/types/feature.ts` - Type definitions
- `src/hooks/useFeatureAccess.ts` - React hooks
- `src/components/common/FeatureGate.tsx` - Gate components
- `src/components/admin/FeatureManagement.tsx` - Admin UI
- `src/components/subscription/SubscriptionPlans.tsx` - Plans UI
- `src/store/userStore.ts` - User state management

## Support

For questions or issues with the feature gating system, please contact the development team or open an issue in the repository.
