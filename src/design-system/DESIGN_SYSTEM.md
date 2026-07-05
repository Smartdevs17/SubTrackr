/\*\*

- SubTrackr Design System - Complete Documentation
-
- This document provides comprehensive guidance on using the design system
- for consistent, accessible, and maintainable UI development.
  \*/

# SubTrackr Design System Documentation

## Overview

The SubTrackr Design System provides a comprehensive set of design tokens, components, and utilities for building accessible, consistent, and themeable user interfaces.

### Key Features

- **Design Tokens**: Centralized colors, spacing, typography, shadows, and animations
- **Base Components**: Button, Input, Card, Modal, Toast (with variants and sizes)
- **Theme System**: Light, Dark, and High Contrast themes with persistence
- **Accessibility**: WCAG 2.1 AA compliant with proper labels, roles, and states
- **Responsiveness**: Platform-aware styling for iOS, Android, and Web
- **RTL Support**: Right-to-left language support with automatic flipping
- **Font Scaling**: Accessible font sizing with WCAG compliance

## Design Tokens

### Colors

The design system uses a semantic color system with three built-in themes:

#### Dark Theme (Default)

- **Primary**: #6366f1 (Indigo)
- **Secondary**: #8b5cf6 (Purple)
- **Accent**: #06b6d4 (Cyan)
- **Success**: #10b981 (Emerald)
- **Warning**: #f59e0b (Amber)
- **Error**: #ef4444 (Red)
- **Info**: #0ea5e9 (Sky)

#### Light Theme

Optimized for daytime use with adjusted saturation and contrast.

#### High Contrast Theme

WCAG AAA compliant with 7:1 minimum contrast ratios for accessibility.

### Spacing

8-point grid system for consistent spacing:

```typescript
spacing: {
  xs: 4,    // Extra small
  sm: 8,    // Small
  md: 16,   // Medium (default)
  lg: 24,   // Large
  xl: 32,   // Extra large
  xxl: 48,  // 2x large
}
```

### Typography

Material Design 3 type scale with WCAG-compliant minimum font sizes:

```typescript
typography: {
  h1: { fontSize: 32, fontWeight: 'bold', lineHeight: 40 },
  h2: { fontSize: 28, fontWeight: 'bold', lineHeight: 36 },
  h3: { fontSize: 24, fontWeight: '600', lineHeight: 32 },
  body: { fontSize: 16, fontWeight: 'normal', lineHeight: 24 },
  bodySmall: { fontSize: 12, fontWeight: 'normal', lineHeight: 18 },
  button: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: 'normal', lineHeight: 16 },
}
```

### Border Radius

Semantic border radius scale:

```typescript
borderRadius: {
  sm: 4,      // Small radius
  md: 8,      // Medium (default)
  lg: 12,     // Large
  xl: 16,     // Extra large
  full: 9999, // Circular/pill
}
```

### Shadows

Material Design elevation system with platform-specific properties:

```typescript
shadows: {
  none: { elevation: 0, shadowOpacity: 0 },
  sm: { elevation: 1, shadowOpacity: 0.05 },
  md: { elevation: 4, shadowOpacity: 0.1 },
  lg: { elevation: 8, shadowOpacity: 0.15 },
  xl: { elevation: 16, shadowOpacity: 0.25 },
}
```

### Animations

Predefined timing and easing:

```typescript
animation: {
  duration: {
    fastest: 50,    // Micro-interactions
    fast: 150,      // State changes
    normal: 300,    // Standard transitions
    slow: 500,      // Deliberate transitions
    slowest: 1000,  // Long animations
  },
}
```

## Components

### Button

Versatile button component with 7 variants and 3 sizes.

#### Usage

```typescript
import { Button } from '@/design-system';

<Button
  label="Click Me"
  variant="primary"
  size="medium"
  onPress={() => {}}
  accessibilityLabel="Action button"
/>
```

#### Variants

- `primary`: Filled primary color (default)
- `secondary`: Filled secondary color
- `outline`: Outlined with border
- `ghost`: Minimal, text-only
- `danger`: Filled error red
- `success`: Filled success green
- `crypto`: Filled accent cyan

#### Sizes

- `small`: 36px height, compact padding
- `medium`: 44px height, standard padding (default)
- `large`: 52px height, spacious padding

#### Props

```typescript
interface ButtonProps extends AccessibilityProps {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}
```

### Input

Text input component with labels, validation, and error states.

#### Usage

```typescript
import { Input } from '@/design-system';

const [value, setValue] = useState('');

<Input
  label="Email"
  placeholder="user@example.com"
  value={value}
  onChangeText={setValue}
  error={!isValidEmail(value) ? 'Invalid email' : undefined}
  helperText="Enter a valid email address"
  required
  accessibilityLabel="Email input field"
/>
```

#### Props

```typescript
interface InputProps extends AccessibilityProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  helperText?: string;
  required?: boolean;
  variant?: 'default' | 'outline' | 'filled';
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}
```

### Card

Container component for content grouping.

#### Usage

```typescript
import { Card } from '@/design-system';

<Card variant="elevated" padding="md">
  <Text>Card content</Text>
</Card>
```

#### Variants

- `default`: Border only
- `elevated`: Shadow elevation
- `outlined`: Distinct border
- `filled`: Solid background

#### Padding Options

- `xs`: 4px
- `sm`: 8px
- `md`: 16px (default)
- `lg`: 24px
- `xl`: 32px

### Modal

Dialog overlay component with animations.

#### Usage

```typescript
import { Modal } from '@/design-system';

const [visible, setVisible] = useState(false);

<Modal
  visible={visible}
  onClose={() => setVisible(false)}
  size="medium"
  accessibilityLabel="Confirmation dialog"
>
  <Text>Modal content</Text>
</Modal>
```

#### Props

```typescript
interface ModalProps extends BaseComponentProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  showBackdrop?: boolean;
  closeOnBackdropTap?: boolean;
  size?: 'small' | 'medium' | 'large' | 'fullscreen';
  animateModal?: boolean;
}
```

### Toast

Temporary notification component.

#### Usage

```typescript
import { Toast } from '@/design-system';

const [visible, setVisible] = useState(false);

<Toast
  message="Changes saved successfully"
  variant="success"
  position="bottom"
  duration={3000}
  onClose={() => setVisible(false)}
  accessibilityLabel="Success notification"
/>
```

#### Variants

- `success`: Green background
- `error`: Red background
- `warning`: Amber background
- `info`: Blue background (default)

#### Positions

- `top`: Top of screen
- `center`: Centered
- `bottom`: Bottom of screen (default)

## Accessibility (WCAG 2.1 AA)

All components are designed with accessibility as a core principle.

### Guidelines

1. **Touch Targets**: Minimum 44x44pt (WCAG 2.1 Level AA)
   - All interactive elements meet this requirement
   - No custom reduction without accessibility consideration

2. **Color Contrast**: Minimum 4.5:1 for normal text, 3:1 for large text
   - All color combinations tested and verified
   - High Contrast theme provides 7:1+ ratios

3. **Semantic Structure**
   - Proper accessibility roles for all components
   - Meaningful labels and hints
   - Live regions for dynamic content

4. **Keyboard Navigation**
   - All components keyboard accessible
   - Proper focus management in modals
   - Visible focus indicators

5. **Font Scaling**
   - `maxFontSizeMultiplier={1.2}` on all text
   - Respects OS-level font scaling settings
   - Minimum 14px base font size for body text

### Accessibility Props

All components support standard accessibility props:

```typescript
interface AccessibilityProps {
  accessibilityLabel: string; // Required - screen reader label
  accessibilityHint?: string; // Optional - additional context
  accessibilityRole?: string; // Optional - semantic role
  testID?: string; // Optional - testing identifier
}
```

### Examples

```typescript
// Good - provides sufficient context
<Button
  label="Save"
  onPress={handleSave}
  accessibilityLabel="Save subscription changes"
  accessibilityHint="Your changes will be applied immediately"
/>

// Error with validation
<Input
  label="Amount"
  value={amount}
  onChangeText={setAmount}
  error={!isValidAmount ? 'Amount must be between $1-$1000' : undefined}
  accessibilityLabel="Subscription amount"
  accessibilityHint={isValidAmount ? undefined : 'Error: Amount must be between $1-$1000'}
/>
```

## Theming

### Using Themes

The design system supports runtime theme switching:

```typescript
import { darkTheme, lightTheme, highContrastTheme } from '@/design-system/tokens';

// Use with context provider (from existing themeStore)
const { currentTheme, setTheme } = useTheme();

// Switch themes
setTheme('light');
setTheme('dark');
setTheme('high-contrast');
```

### Custom Themes

Create custom brand themes:

```typescript
const brandTheme: Theme = {
  id: 'brand',
  name: 'Brand',
  mode: 'dark',
  colors: {
    primary: '#YOUR_BRAND_COLOR',
    // ... other color overrides
  },
};
```

## Platform-Specific Styling

The design system handles platform differences automatically:

```typescript
import { isIOS, isAndroid, getPlatformValue } from '@/design-system/utils';

// Platform detection
if (isIOS()) {
  // iOS-specific code
}

// Conditional values
const elevation = getPlatformValue(
  4, // iOS shadow
  8, // Android elevation
  '0 2px 4px rgba(0,0,0,0.1)' // Web box-shadow
);
```

## RTL (Right-to-Left) Support

Automatic handling of RTL languages:

```typescript
import { isRTL, getDirectionalValue } from '@/design-system/utils';

// Check RTL
if (isRTL()) {
  // RTL-specific adjustments
}

// Directional values
const margin = getDirectionalValue(16, 24); // start: 16, end: 24
```

## Font Scaling

All components respect WCAG font scaling requirements:

```typescript
import { validateFontSizes, WCAG_MINIMUM_FONT_SIZE } from '@/design-system/utils';

// Validate typography scale
const violations = validateFontSizes(typographyScale);
if (violations.length > 0) {
  console.warn('Typography accessibility violations:', violations);
}
```

## Storybook

Component documentation is available in Storybook:

```bash
npm run storybook
# Open http://localhost:6006
```

### Adding Stories

Create `ComponentName.stories.tsx`:

```typescript
import type { Meta, StoryObj } from '@storybook/react-native';
import { Button } from '../components/Button';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  // ... configuration
};

export const Primary: Story = {
  args: { label: 'Click', variant: 'primary' },
};
```

## Testing

### Unit Tests

```bash
npm test src/design-system
```

Tests cover:

- Component rendering
- User interactions
- Accessibility compliance
- State management

### Visual Regression

```bash
npm run e2e:test-ios
npm run e2e:test-android
```

E2E tests verify:

- Visual consistency across platforms
- Theme application
- RTL layout
- Accessibility features

## Common Patterns

### Form with Validation

```typescript
const [formData, setFormData] = useState({
  email: '',
  amount: '',
});

const [errors, setErrors] = useState<Record<string, string>>({});

const handleChange = (field: string, value: string) => {
  setFormData(prev => ({ ...prev, [field]: value }));
  // Clear error on change
  setErrors(prev => ({ ...prev, [field]: '' }));
};

const handleSubmit = () => {
  const newErrors: Record<string, string> = {};

  if (!isValidEmail(formData.email)) {
    newErrors.email = 'Invalid email address';
  }

  if (!isValidAmount(formData.amount)) {
    newErrors.amount = 'Amount must be between $1-$1000';
  }

  if (Object.keys(newErrors).length === 0) {
    // Submit form
  } else {
    setErrors(newErrors);
  }
};

return (
  <>
    <Input
      label="Email"
      value={formData.email}
      onChangeText={(value) => handleChange('email', value)}
      error={errors.email}
      required
      accessibilityLabel="Email input"
    />
    <Input
      label="Amount"
      value={formData.amount}
      onChangeText={(value) => handleChange('amount', value)}
      error={errors.amount}
      required
      accessibilityLabel="Amount input"
    />
    <Button
      label="Submit"
      onPress={handleSubmit}
      fullWidth
      accessibilityLabel="Submit form"
    />
  </>
);
```

## Best Practices

1. **Always provide accessibility labels** for interactive components
2. **Use semantic variants** - choose variant based on visual hierarchy
3. **Respect touch targets** - maintain 44x44pt minimum
4. **Test with screen readers** - VoiceOver on iOS, TalkBack on Android
5. **Use design tokens** - avoid hardcoding values
6. **Support all themes** - test with light, dark, and high contrast
7. **Consider RTL** - test with RTL languages
8. **Handle loading states** - provide user feedback during async operations
9. **Validate input** - show errors immediately
10. **Document custom components** - add Storybook stories and tests

## Migration Guide

To migrate existing components to use the design system:

1. Replace hardcoded colors with design tokens
2. Update spacing to use `spacing` token
3. Apply typography styles from `typography` token
4. Add accessibility props to interactive elements
5. Update shadows to use `shadows` token
6. Test with all themes and platforms
7. Add Storybook stories for documentation
8. Add unit and E2E tests

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Material Design 3](https://m3.material.io/)
- [React Native Accessibility](https://reactnative.dev/docs/accessibility)
- [Storybook React Native](https://storybook.js.org/docs/react-native/get-started/install)
- [Detox E2E Testing](https://wix.github.io/Detox/docs/intro/welcome)

## Support

For questions or issues with the design system:

1. Check this documentation
2. Review Storybook examples
3. Check existing tests
4. Open an issue in the repository
