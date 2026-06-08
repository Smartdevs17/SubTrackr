/**
 * Design System Setup & Installation Guide
 */

# SubTrackr Design System - Setup Guide

## Quick Start

The SubTrackr Design System has been successfully created and is ready for integration into your project.

## What Was Created

### ✓ Design Tokens (5 files)
- **colors.ts**: Dark, Light, and High Contrast themes with WCAG AA compliance
- **spacing.ts**: 8-point grid system (xs: 4px → xxl: 48px)
- **typography.ts**: Material Design 3 type scale with accessibility
- **borderRadius.ts**: Semantic radius scale for components
- **shadows.ts**: Material Design elevation system (iOS + Android)
- **animations.ts**: Standardized timing and easing functions

### ✓ Base Components (5 components)
- **Button**: 7 variants, 3 sizes, loading & disabled states
- **Input**: Labels, validation, error states, icons
- **Card**: 4 variants, configurable padding, platform-specific styling
- **Modal**: Size presets, animations, focus management
- **Toast**: 4 variants, multiple positions, auto-dismiss

### ✓ Utilities (3 modules)
- **platform.ts**: iOS/Android/Web detection and conditional values
- **rtl.ts**: Right-to-left language support
- **fontScaling.ts**: WCAG-compliant font sizing

### ✓ Testing & Documentation
- **Button.test.tsx**: Comprehensive unit tests with accessibility checks
- **visualRegression.e2e.ts**: E2E tests for all components
- **Button.stories.tsx**: Storybook component documentation
- **DESIGN_SYSTEM.md**: Complete design system documentation
- **DESIGN_SYSTEM_INTEGRATION.md**: Step-by-step integration guide
- **WCAG_COMPLIANCE.md**: Accessibility compliance checklist

### ✓ Storybook Configuration
- **.storybook/main.js**: Storybook configuration
- **.storybook/preview.js**: Preview settings with themes

## Directory Structure

```
src/design-system/
├── index.ts                          # Main export
├── README.md                         # Quick reference
├── DESIGN_SYSTEM.md                  # Full documentation
├── types/
│   └── design-tokens.ts              # All TypeScript types
├── tokens/
│   ├── index.ts                      # Token exports
│   ├── colors.ts                     # Theme colors (3 themes)
│   ├── spacing.ts                    # 8-point grid
│   ├── typography.ts                 # Type scale
│   ├── borderRadius.ts               # Border radius scale
│   ├── shadows.ts                    # Elevation system
│   └── animations.ts                 # Timing functions
├── components/
│   ├── index.ts                      # Component exports
│   ├── Button.tsx                    # Button component
│   ├── Input.tsx                     # Input component
│   ├── Card.tsx                      # Card component
│   ├── Modal.tsx                     # Modal component
│   └── Toast.tsx                     # Toast component
├── utils/
│   ├── index.ts                      # Utility exports
│   ├── platform.ts                   # Platform detection
│   ├── rtl.ts                        # RTL support
│   └── fontScaling.ts                # Font scaling utilities
├── hooks/
│   └── (theme hooks ready to be added)
├── __tests__/
│   ├── Button.test.tsx               # Unit tests
│   └── visualRegression.e2e.ts       # E2E tests
└── stories/
    └── Button.stories.tsx            # Storybook stories
```

## Installation & Setup

### 1. Install Storybook (Optional but Recommended)

```bash
# Install Storybook for component documentation
npx sb@latest init --type react-native

# Or manually add dependencies
npm install --save-dev @storybook/react-native @storybook/addon-essentials
```

### 2. Verify Configuration

The Storybook configuration is already in place:
- `.storybook/main.js`
- `.storybook/preview.js`

### 3. Run Tests

```bash
# Unit tests
npm test src/design-system

# E2E tests (iOS)
npm run e2e:build-ios
npm run e2e:test-ios

# E2E tests (Android)
npm run e2e:build-android
npm run e2e:test-android
```

### 4. Start Storybook (Optional)

```bash
npm run storybook
# Open http://localhost:6006
```

## Usage Examples

### Import Tokens

```typescript
import {
  colors,
  spacing,
  typography,
  borderRadius,
  shadows,
  animation,
} from '@/design-system/tokens';

// Or specific imports
import { darkTheme, lightTheme } from '@/design-system/tokens/colors';
import { spacing } from '@/design-system/tokens';
```

### Import Components

```typescript
import {
  Button,
  Input,
  Card,
  Modal,
  Toast,
} from '@/design-system';

// Usage
<Button
  label="Save"
  variant="primary"
  onPress={() => {}}
  accessibilityLabel="Save changes"
/>
```

### Use Utilities

```typescript
import {
  isIOS,
  isAndroid,
  isRTL,
  validateFontSizes,
} from '@/design-system/utils';

if (isIOS()) {
  // iOS-specific code
}

if (isRTL()) {
  // RTL-specific layout
}
```

## Migration Path

### Phase 1: Review & Planning (1-2 days)
- [ ] Review this documentation
- [ ] Review Storybook stories
- [ ] Identify components to migrate
- [ ] Plan update order (high-impact first)

### Phase 2: Component Migration (1-2 weeks)
- [ ] Update imports in screens
- [ ] Update component usage
- [ ] Replace color hardcoding with tokens
- [ ] Replace spacing hardcoding with tokens
- [ ] Add accessibility labels

### Phase 3: Testing & Validation (3-5 days)
- [ ] Run unit tests
- [ ] Run E2E tests
- [ ] Visual regression testing
- [ ] Accessibility testing
- [ ] Manual testing on devices

### Phase 4: Documentation & Deployment (1-2 days)
- [ ] Update component documentation
- [ ] Add Storybook stories
- [ ] Add migration notes
- [ ] Deploy with feature flag (optional)

## File-by-File Checklist

### src/screens/
- [ ] SubscriptionList.tsx
- [ ] SubscriptionDetail.tsx
- [ ] Settings.tsx
- [ ] Home.tsx
- [ ] Profile.tsx
- [ ] (other screens)

### src/components/
- [ ] subscription/ (update domain components)
- [ ] home/ (update domain components)
- [ ] admin/ (update domain components)
- [ ] common/ (remove or refactor)

### src/app/
- [ ] (check for inline styles)

## Key Features

### ✓ Design Tokens
- Dark, Light, High Contrast themes
- WCAG 2.1 AA compliant colors
- 8-point spacing grid
- Material Design 3 typography
- Elevation system for iOS & Android
- Predefined animations

### ✓ Components
- 5 base components with multiple variants
- WCAG 2.1 AA accessibility
- Platform-specific styling
- RTL support
- Font scaling compliance
- Loading and error states

### ✓ Accessibility
- Minimum 44x44pt touch targets
- Semantic roles and labels
- Screen reader support
- Keyboard navigation
- Focus management
- High contrast support

### ✓ Testing
- Unit tests with accessibility checks
- E2E visual regression tests
- Storybook documentation
- Component story examples

## Performance

The design system is optimized for performance:

- **StyleSheet API**: All styles use React Native's StyleSheet for optimization
- **No unnecessary re-renders**: Components properly memoized
- **Minimal bundle size**: Only core components, no heavy dependencies
- **Lazy loading**: Import only what you need

## Troubleshooting

### Q: Components not rendering?
**A**: Check imports are from `@/design-system`, not subdirectories

### Q: Colors not applying?
**A**: Use color tokens from `@/design-system/tokens/colors`

### Q: Accessibility not working?
**A**: Ensure `accessibilityLabel` prop is provided on interactive elements

### Q: Theme not switching?
**A**: Check existing `themeStore` integration in `src/theme/`

## Next Steps

1. **Review Documentation**: Read [DESIGN_SYSTEM.md](./src/design-system/DESIGN_SYSTEM.md)
2. **Review Integration Guide**: Read [DESIGN_SYSTEM_INTEGRATION.md](./DESIGN_SYSTEM_INTEGRATION.md)
3. **Review Compliance**: Read [WCAG_COMPLIANCE.md](./WCAG_COMPLIANCE.md)
4. **Check Storybook**: Run `npm run storybook` to see components
5. **Start Migration**: Begin with high-impact screens
6. **Run Tests**: Verify accessibility and functionality
7. **Deploy**: Integrate into your workflow

## Support & Questions

For questions about the design system:

1. Check [DESIGN_SYSTEM.md](./src/design-system/DESIGN_SYSTEM.md)
2. Review [Storybook examples](./src/design-system/stories/)
3. Check existing tests for usage patterns
4. Review WCAG guidelines at [w3.org](https://www.w3.org/WAI/WCAG21/quickref/)

## Resources

- [Design System Documentation](./src/design-system/DESIGN_SYSTEM.md)
- [Integration Guide](./DESIGN_SYSTEM_INTEGRATION.md)
- [WCAG Compliance](./WCAG_COMPLIANCE.md)
- [Storybook](http://localhost:6006)
- [WCAG 2.1](https://www.w3.org/WAI/WCAG21/quickref/)
- [Material Design 3](https://m3.material.io/)
- [React Native Accessibility](https://reactnative.dev/docs/accessibility)

---

**Design System Version**: 1.0.0
**Last Updated**: May 28, 2026
**Status**: ✓ Production Ready
