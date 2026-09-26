# Accessibility Guide - SubTrackr

This guide documents the accessibility patterns, components, and best practices used throughout the SubTrackr application to ensure WCAG 2.1 AA compliance.

## Table of Contents

- [Overview](#overview)
- [WCAG 2.1 AA Compliance](#wcag-21-aa-compliance)
- [Accessibility Patterns](#accessibility-patterns)
- [Component Guidelines](#component-guidelines)
- [Color Contrast](#color-contrast)
- [Focus Management](#focus-management)
- [Screen Reader Support](#screen-reader-support)
- [Dynamic Type Support](#dynamic-type-support)
- [Testing](#testing)
- [CI Integration](#ci-integration)

## Overview

SubTrackr is committed to making the application accessible to all users, including those who use assistive technologies. This guide provides developers with the necessary information to maintain and improve accessibility across the application.

### Key Accessibility Features

- **Semantic Labels**: All interactive elements have descriptive `accessibilityLabel` props
- **Roles**: Proper `accessibilityRole` assignments for screen reader context
- **Hints**: `accessibilityHint` for complex interactions
- **State Announcements**: Screen reader announcements for state changes
- **Focus Management**: Proper focus trapping in modals and bottom sheets
- **Dynamic Type**: Font scaling support up to 1.5x
- **Color Contrast**: WCAG 2.1 AA compliant color palette
- **Keyboard Navigation**: KeyboardAvoidingView for form inputs

## WCAG 2.1 AA Compliance

### Standards Met

- **Normal text contrast**: 4.5:1 minimum
- **Large text contrast**: 3:1 minimum
- **UI component contrast**: 3:1 minimum
- **Focus indicators**: Visible focus states
- **Text resizing**: Supports up to 200% zoom
- **Screen reader**: Compatible with VoiceOver and TalkBack

### Compliance Documentation

See [ACCESSIBILITY_COLOR_CONTRAST.md](./ACCESSIBILITY_COLOR_CONTRAST.md) for detailed color contrast analysis.

## Accessibility Patterns

### 1. Interactive Elements

#### Buttons

All buttons must have:
- `accessibilityRole="button"`
- `accessibilityLabel` describing the action
- `accessibilityHint` for complex actions (optional)
- `accessibilityState` for disabled/busy states

```tsx
<Button
  title="Save Changes"
  onPress={handleSave}
  accessibilityLabel="Save changes"
  accessibilityHint="Saves your current changes"
  disabled={isSaving}
  accessibilityState={{ disabled: isSaving }}
/>
```

#### Touchable Elements

For custom touchable elements:
```tsx
<TouchableOpacity
  onPress={handleAction}
  accessibilityRole="button"
  accessibilityLabel="Action name"
  accessibilityHint="Additional context"
  accessibilityState={{ selected: isSelected }}
>
  {/* Content */}
</TouchableOpacity>
```

### 2. Form Inputs

#### Text Fields

All text inputs must have:
- `accessibilityLabel` describing the field
- `accessibilityHint` for format requirements (optional)
- Proper keyboard type

```tsx
<TextInput
  accessibilityLabel="Email address"
  accessibilityHint="Enter your email address"
  keyboardType="email-address"
  placeholder="email@example.com"
/>
```

#### Switches

```tsx
<Switch
  value={isEnabled}
  onValueChange={toggle}
  accessibilityLabel="Enable notifications"
  accessibilityRole="switch"
  accessibilityState={{ checked: isEnabled }}
/>
```

### 3. Modals and Bottom Sheets

#### Focus Management

Use the `useFocusManagement` hook for proper focus trapping:

```tsx
import { useFocusManagement } from '../../hooks/useFocusManagement';

const MyModal = ({ visible, onClose }) => {
  const { setInitialFocus } = useFocusManagement(visible);
  const firstInputRef = useRef(null);

  useEffect(() => {
    if (visible && firstInputRef.current) {
      setInitialFocus(firstInputRef.current);
    }
  }, [visible, setInitialFocus]);

  return (
    <Modal
      visible={visible}
      accessibilityViewIsModal={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView behavior="padding">
        <SafeAreaView>
          <TextInput
            ref={firstInputRef}
            accessibilityLabel="First input"
          />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
};
```

#### Modal Properties

- `accessibilityViewIsModal={true}` on Modal component
- `KeyboardAvoidingView` wrapper for keyboard handling
- Initial focus set to first interactive element
- Close button with clear accessibility label

### 4. Lists and Cards

#### Subscription Cards

```tsx
<TouchableOpacity
  onPress={handlePress}
  accessibilityRole="button"
  accessibilityLabel={`${subscription.name}, ${formatCurrency(price)} per ${cycle}`}
  accessibilityState={{ selected: isSelected }}
  accessibilityHint="Tap to view details"
>
  {/* Card content */}
</TouchableOpacity>
```

#### List Items

- Use `accessibilityRole="list"` for container
- Use `accessibilityRole="listitem"` for items
- Provide context in labels

### 5. State Changes

#### Screen Reader Announcements

Use the `useAccessibilityAnnouncement` hook for important state changes:

```tsx
import { useAccessibilityAnnouncement } from '../../hooks/useAccessibilityAnnouncement';

const MyComponent = () => {
  const { announce } = useAccessibilityAnnouncement();

  const handleDelete = () => {
    announce('Deleting subscription');
    // Perform deletion
    announce('Subscription deleted successfully');
  };
};
```

#### When to Announce

- Successful actions (save, delete, update)
- Error states
- Loading state changes
- Navigation events
- Filter changes

### 6. Dynamic Type Support

All text elements should support font scaling:

```tsx
<Text
  style={styles.text}
  maxFontSizeMultiplier={1.5}
  allowFontScaling={true}
>
  Scalable text
</Text>
```

#### Scaling Guidelines

- Body text: 1.5x multiplier
- Headings: 1.3x multiplier
- Captions: 1.2x multiplier
- Buttons: 1.5x multiplier

## Component Guidelines

### Button Component

The `Button` component has built-in accessibility support:

```tsx
interface ButtonProps {
  title: string;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  loading?: boolean;
}
```

**Usage:**
```tsx
<Button
  title="Submit"
  onPress={handleSubmit}
  accessibilityLabel="Submit form"
  accessibilityHint="Submits your subscription details"
/>
```

### Card Component

The `Card` component supports optional accessibility props:

```tsx
interface CardProps {
  children: React.ReactNode;
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
}
```

**Usage:**
```tsx
<Card
  accessible={true}
  accessibilityLabel="Subscription summary"
  accessibilityRole="summary"
>
  {/* Content */}
</Card>
```

### FilterBar Component

The `FilterBar` includes:
- Search input with label
- Filter button with active count announcement
- Clear search button

### FilterModal Component

The `FilterModal` includes:
- Focus management with initial focus
- KeyboardAvoidingView for keyboard handling
- AccessibilityViewIsModal flag
- Proper role assignments for checkboxes and switches

### SubscriptionCard Component

The `SubscriptionCard` includes:
- Accessibility label with subscription details
- State announcements for toggle/delete
- Dynamic type support
- Proper role assignments

## Color Contrast

### Updated Color Palette

The color palette has been updated to meet WCAG 2.1 AA standards:

| Color | Old Value | New Value | Reason |
|-------|-----------|-----------|--------|
| Primary | #6366f1 | #818cf8 | Better contrast on dark backgrounds |
| Secondary | #8b5cf6 | #a78bfa | Better contrast on dark backgrounds |
| Accent | #06b6d4 | #22d3ee | Better contrast on dark backgrounds |
| Success | #10b981 | #34d399 | Better contrast on dark backgrounds |
| Warning | #f59e0b | #fbbf24 | Better contrast on dark backgrounds |
| Error | #ef4444 | #f87171 | Better contrast on dark backgrounds |
| Border | #334155 | #64748b | Better visibility |

### Contrast Ratios

All color combinations now meet or exceed WCAG 2.1 AA requirements:
- Text on background: 7.2:1 (exceeds 4.5:1 requirement)
- Primary on background: 3.2:1 (meets 3:1 UI requirement)
- Error on background: 3.8:1 (meets 3:1 UI requirement)

See [ACCESSIBILITY_COLOR_CONTRAST.md](./ACCESSIBILITY_COLOR_CONTRAST.md) for full analysis.

## Focus Management

### useFocusManagement Hook

Custom hook for managing focus in modals and bottom sheets:

```tsx
const { setInitialFocus, registerFocusable, unregisterFocusable } = useFocusManagement(visible);
```

**Features:**
- Automatic initial focus when modal opens
- Focus registration for tab order
- Return focus on modal close

### Focus Best Practices

1. **Initial Focus**: Set focus to the first interactive element when a modal opens
2. **Focus Trapping**: Keep focus within the modal while open
3. **Return Focus**: Return focus to the trigger element when closing
4. **Visible Focus**: Ensure focus indicators are clearly visible

## Screen Reader Support

### Accessibility Roles

Use appropriate roles for semantic meaning:

| Role | Usage |
|------|-------|
| `button` | Clickable actions |
| `link` | Navigation links |
| `text` | Static text content |
| `header` | Section headers |
| `summary` | Summary cards |
| `search` | Search inputs |
| `switch` | Toggle switches |
| `checkbox` | Checkable items |
| `tab` | Tab navigation |
| `tablist` | Tab container |

### Accessibility States

Use states to convey component state:

```tsx
accessibilityState={{
  disabled: isDisabled,
  selected: isSelected,
  checked: isChecked,
  busy: isLoading,
  expanded: isExpanded,
}}
```

### Accessibility Hints

Provide hints for complex interactions:

```tsx
accessibilityHint="Swipe left to delete, tap to view details"
```

## Dynamic Type Support

### Implementation

All text components support dynamic type scaling:

```tsx
<Text
  maxFontSizeMultiplier={1.5}
  allowFontScaling={true}
>
  Scalable text
</Text>
```

### Testing

Test with different font sizes:
- iOS: Settings > Accessibility > Display & Text Size > Larger Text
- Android: Settings > Accessibility > Font size

## Testing

### Accessibility Tests

Run accessibility tests:

```bash
npm run test:a11y
```

### Manual Testing Checklist

- [ ] All buttons have accessibility labels
- [ ] All inputs have descriptive labels
- [ ] Focus order is logical
- [ ] Screen reader announces all important information
- [ ] Color contrast meets WCAG standards
- [ ] Dynamic type works correctly
- [ ] Modals trap focus properly
- [ ] State changes are announced

### Testing Tools

- **iOS**: VoiceOver (Settings > Accessibility > VoiceOver)
- **Android**: TalkBack (Settings > Accessibility > TalkBack)
- **Web**: axe DevTools or WAVE

## CI Integration

### Accessibility Test Job

Accessibility tests run automatically in CI:

```yaml
accessibility-tests:
  name: Accessibility Tests
  runs-on: ubuntu-latest
  steps:
    - name: Run accessibility tests
      run: npm run test:a11y
```

### Blocking PRs

Accessibility tests are part of the merge protection gate. PRs with accessibility violations will be blocked from merging.

### Coverage Reports

Accessibility reports are uploaded as artifacts for review.

## Custom Hooks

### useAccessibilityAnnouncement

Hook for announcing screen reader messages:

```tsx
const { announce, announceIfChanged } = useAccessibilityAnnouncement();

announce('Action completed');
announceIfChanged(newValue, 'Value changed to {value}');
```

### useFocusManagement

Hook for managing focus in modals:

```tsx
const { setInitialFocus, registerFocusable, unregisterFocusable } = useFocusManagement(visible);
```

## Best Practices

### DO

- Provide descriptive labels for all interactive elements
- Use semantic roles appropriately
- Announce important state changes
- Support dynamic type scaling
- Ensure color contrast meets WCAG standards
- Test with screen readers
- Manage focus properly in modals

### DON'T

- Use generic labels like "Button 1"
- Hide important information from screen readers
- Rely solely on color to convey information
- Use fixed font sizes
- Skip accessibility testing
- Break focus order

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [React Native Accessibility](https://reactnative.dev/docs/accessibility)
- [iOS Accessibility Guidelines](https://developer.apple.com/accessibility/)
- [Android Accessibility Guidelines](https://developer.android.com/guide/topics/ui/accessibility/)

## Changelog

### Version 1.0 (2026-06-25)

- Initial accessibility audit completed
- Added accessibility labels to all interactive elements
- Implemented focus management for modals
- Added dynamic type support (1.5x scaling)
- Updated color palette to WCAG 2.1 AA standards
- Added screen reader announcements for state changes
- Implemented keyboard navigation support
- Added accessibility test automation
- Integrated accessibility checks into CI pipeline
- Created accessibility documentation
