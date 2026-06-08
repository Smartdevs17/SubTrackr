/**
 * Design System Integration Guide
 * 
 * Step-by-step guide for integrating the new design system into SubTrackr
 */

# Design System Integration Guide

## Overview

The SubTrackr Design System has been implemented with comprehensive tokens, components, and utilities. This guide walks you through integrating it into your existing codebase.

## Current State

### New Design System Structure

```
src/design-system/
├── index.ts                 # Main export
├── README.md               # Quick reference
├── DESIGN_SYSTEM.md        # Full documentation
├── tokens/
│   ├── index.ts
│   ├── colors.ts           # Dark, Light, High Contrast themes
│   ├── spacing.ts          # 8-point grid system
│   ├── typography.ts       # Material Design 3 type scale
│   ├── borderRadius.ts     # Semantic radius scale
│   ├── shadows.ts          # Elevation system
│   └── animations.ts       # Timing and easing
├── components/
│   ├── index.ts
│   ├── Button.tsx          # 7 variants, 3 sizes
│   ├── Input.tsx           # Labels, validation, icons
│   ├── Card.tsx            # 4 variants, configurable padding
│   ├── Modal.tsx           # Sizes, animations, backdrop
│   └── Toast.tsx           # 4 variants, auto-dismiss
├── types/
│   └── design-tokens.ts    # Complete type definitions
├── utils/
│   ├── platform.ts         # iOS/Android/Web detection
│   ├── rtl.ts              # RTL language support
│   ├── fontScaling.ts      # WCAG font size compliance
│   └── index.ts
├── hooks/
│   └── (theme hooks to be created)
├── __tests__/
│   ├── Button.test.tsx     # Unit tests
│   └── visualRegression.e2e.ts # E2E tests
└── stories/
    └── Button.stories.tsx  # Storybook documentation
```

## Integration Steps

### Step 1: Review Existing Components

The design system extracts and improves existing components:

**Existing Components** → **Design System Components**
- `src/components/common/Button.tsx` → `src/design-system/components/Button.tsx`
- `src/components/common/Card.tsx` → `src/design-system/components/Card.tsx`
- Manual Input implementations → `src/design-system/components/Input.tsx`
- Manual Modal implementations → `src/design-system/components/Modal.tsx`
- Manual Toast implementations → `src/design-system/components/Toast.tsx`

### Step 2: Update Imports

Update component imports throughout the codebase:

**Before:**
```typescript
import { Button } from '@/components/common';
import { Card } from '@/components/common';
```

**After:**
```typescript
import { Button, Card, Input, Modal, Toast } from '@/design-system';
```

### Step 3: Update Color References

Replace hardcoded colors with design tokens:

**Before:**
```typescript
const buttonStyle = {
  backgroundColor: '#6366f1',
  color: '#ffffff',
};
```

**After:**
```typescript
import { colors } from '@/design-system/tokens';

const buttonStyle = {
  backgroundColor: colors.primary,
  color: colors.onPrimary,
};
```

### Step 4: Update Spacing

Replace hardcoded spacing values with the spacing scale:

**Before:**
```typescript
const styles = StyleSheet.create({
  container: {
    padding: 16,
    marginBottom: 24,
    gap: 8,
  },
});
```

**After:**
```typescript
import { spacing } from '@/design-system/tokens';

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
});
```

### Step 5: Update Typography

Apply consistent typography styles:

**Before:**
```typescript
<Text style={{ fontSize: 16, fontWeight: '600', lineHeight: 24 }}>
  Heading
</Text>
```

**After:**
```typescript
import { typography } from '@/design-system/tokens';

<Text style={typography.h3}>Heading</Text>
```

### Step 6: Add Accessibility Labels

Ensure all interactive elements have proper accessibility labels:

**Before:**
```typescript
<TouchableOpacity onPress={handlePress}>
  <Text>Save</Text>
</TouchableOpacity>
```

**After:**
```typescript
<Button
  label="Save"
  onPress={handlePress}
  accessibilityLabel="Save subscription changes"
  accessibilityHint="Your changes will be applied immediately"
/>
```

### Step 7: Update Existing Components

For components that use the base components, ensure they respect the design system:

```typescript
import {
  Button,
  Card,
  Input,
  Modal,
  Toast,
  spacing,
  typography,
  colors,
} from '@/design-system';

export const SubscriptionCard = ({ subscription }: Props) => {
  return (
    <Card variant="elevated" padding="md">
      <Text style={typography.h3}>{subscription.name}</Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        ${subscription.price}/month
      </Text>
      <Button
        label="Manage"
        variant="primary"
        onPress={() => {}}
        accessibilityLabel={`Manage ${subscription.name} subscription`}
      />
    </Card>
  );
};
```

### Step 8: Update Tests

Update test imports and add accessibility checks:

**Before:**
```typescript
import { render } from '@testing-library/react-native';
import { Button } from '@/components/common';
```

**After:**
```typescript
import { render } from '@testing-library/react-native';
import { Button } from '@/design-system';

describe('Button', () => {
  it('should have accessibility label', () => {
    const { getByLabelText } = render(
      <Button
        label="Save"
        onPress={() => {}}
        accessibilityLabel="Save button"
      />
    );
    expect(getByLabelText('Save button')).toBeTruthy();
  });
});
```

## File-by-File Migration

### Step 1: Screens and Pages

Update all screens to use design system components:

```
src/screens/
├── SubscriptionList.tsx     # Update imports
├── SubscriptionDetail.tsx   # Update imports
├── Settings.tsx             # Update imports
└── ...
```

Example:
```typescript
import { Button, Card, Toast } from '@/design-system';
import { spacing, typography } from '@/design-system/tokens';

export const SubscriptionList = () => {
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ gap: spacing.md, padding: spacing.lg }}>
      <Text style={typography.h1}>My Subscriptions</Text>
      
      {subscriptions.map((sub) => (
        <Card key={sub.id} variant="elevated" padding="md">
          <Text style={typography.h3}>{sub.name}</Text>
          <Button
            label="Details"
            onPress={() => {}}
            accessibilityLabel={`View details for ${sub.name}`}
          />
        </Card>
      ))}

      <Toast
        visible={visible}
        message="Subscription updated"
        variant="success"
        onClose={() => setVisible(false)}
      />
    </View>
  );
};
```

### Step 2: Common Components

Update `src/components/common/` to use design system or remove if replaced:

- **Button.tsx**: Remove, use `@/design-system` instead
- **Card.tsx**: Remove, use `@/design-system` instead
- **Other components**: Update to use design tokens

### Step 3: Domain Components

Update domain-specific components (subscription, home, etc.):

```typescript
// src/components/subscription/SubscriptionCard.tsx
import { Card, Button, typography } from '@/design-system';

export const SubscriptionCard = ({ item }: Props) => (
  <Card variant="elevated" padding="md">
    <Text style={typography.h3}>{item.name}</Text>
    <Button label="Manage" onPress={() => {}} />
  </Card>
);
```

## Testing Checklist

Before deploying the design system migration:

### Unit Tests ✓

```bash
npm test src/design-system
```

### Component Tests ✓

```bash
npm test src/components
```

### E2E Tests

```bash
npm run e2e:test-ios
npm run e2e:test-android
```

### Visual Regression Tests

```bash
npm run e2e:visual:update-ios
```

### Accessibility Tests

- [ ] All buttons have accessibility labels
- [ ] All inputs have labels or accessibility hints
- [ ] All modals have accessibility roles
- [ ] All text meets WCAG font size minimums
- [ ] Test with VoiceOver (iOS) and TalkBack (Android)
- [ ] Verify colors meet contrast requirements
- [ ] Test with RTL language

### Theme Tests

- [ ] Dark theme applies correctly
- [ ] Light theme applies correctly
- [ ] High Contrast theme applies correctly
- [ ] Theme persistence works
- [ ] Theme switching is smooth

### Platform Tests

- [ ] iOS rendering is correct
- [ ] Android rendering is correct
- [ ] Web rendering is correct (if applicable)
- [ ] Shadows render correctly on each platform
- [ ] Font sizes are readable on all platforms

## Performance Considerations

The design system is optimized for performance:

1. **No unnecessary re-renders**: Components use `React.memo` where appropriate
2. **Efficient styling**: StyleSheet API for optimized styles
3. **Lazy loading**: Import only what you need
4. **Minimal dependencies**: Core components only depend on React Native

## Troubleshooting

### Components not rendering

Ensure imports are correct:
```typescript
// ✓ Correct
import { Button } from '@/design-system';

// ✗ Wrong
import { Button } from '@/design-system/components';
```

### Colors not applying

Make sure to use color tokens:
```typescript
// ✓ Correct
import { colors } from '@/design-system/tokens';
const backgroundColor = colors.primary;

// ✗ Wrong
const backgroundColor = '#6366f1';
```

### Accessibility not working

Verify accessibility props are passed:
```typescript
// ✓ Correct
<Button
  label="Save"
  accessibilityLabel="Save changes"
  onPress={() => {}}
/>

// ✗ Wrong
<Button label="Save" onPress={() => {}} />
```

## Next Steps

1. **Start with screens**: Begin migration with high-impact screens
2. **Update components**: Refactor common components
3. **Add tests**: Ensure tests cover all accessibility requirements
4. **Document**: Add Storybook stories for all components
5. **Deploy**: Roll out with feature flag if needed

## Resources

- [Design System Documentation](./DESIGN_SYSTEM.md)
- [Storybook](http://localhost:6006)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Material Design 3](https://m3.material.io/)
