# SubTrackr Animation System

A comprehensive animation system for React Native that provides smooth transitions, micro-interactions, and performance-optimized animations for subscription management.

## Features

### ✅ Shared Element Transitions

- Smooth transitions between screens when navigating
- Maintains visual continuity for subscription cards
- Supports fade, scale, and slide transition types

### ✅ Enter/Exit Animations

- Staggered list animations for subscription cards
- Screen transition animations with customizable timing
- Loading state animations with skeleton placeholders

### ✅ Loading Skeletons

- Animated skeleton placeholders during data loading
- Pulse animation for visual feedback
- Customizable skeleton components for different content types

### ✅ Value Change Animations

- Price change animations with bounce effects
- Status toggle animations with scale transitions
- Smooth value interpolation for numeric changes

### ✅ Gesture-Driven Animations

- Swipeable subscription cards with action reveals
- Press animations with scale feedback
- Long press animations with rotation effects
- Pan gesture handling for custom interactions

### ✅ Performance Optimization

- Native driver usage for 60fps animations
- Animation batching to prevent layout thrashing
- Memory-efficient animation pools
- Power-aware animation adjustments

## Architecture

### Core Components

#### Animation Utilities (`src/utils/animations.ts`)

- Pre-built animation presets (fade, scale, slide, bounce)
- Shared element transition management
- Interpolation utilities and easing functions
- Animation composition helpers

#### Performance Hooks (`src/hooks/useAnimationPerformance.ts`)

- Animation lifecycle management
- InteractionManager integration
- Animation batching utilities
- Performance monitoring and metrics

#### Animated Components

- `AnimatedSubscriptionCard`: Enhanced subscription card with animations
- `SubscriptionListSkeleton`: Loading state placeholders
- `ScreenTransition`: Screen-level transition wrapper
- `SharedElement`: Cross-screen element transitions
- `SwipeableSubscriptionCard`: Gesture-driven card interactions

## Usage Examples

### Basic Screen Transitions

```tsx
import { ScreenTransition } from '../animations';

<ScreenTransition type="fade" duration={400}>
  <YourScreenContent />
</ScreenTransition>;
```

### Shared Element Transitions

```tsx
import { SharedElement } from '../animations';

// In source screen
<SharedElement id="subscription-title">
  <Text>{subscription.name}</Text>
</SharedElement>

// In destination screen
<SharedElement id="subscription-title">
  <Text>{subscription.name}</Text>
</SharedElement>
```

### Animated Subscription Cards

```tsx
import { AnimatedSubscriptionCard } from '../animations';

<AnimatedSubscriptionCard
  subscription={subscription}
  onPress={handlePress}
  sharedElementId={`subscription-${subscription.id}`}
  index={index}
/>;
```

### Loading Skeletons

```tsx
import { SubscriptionListSkeleton } from '../animations';

{
  isLoading ? (
    <SubscriptionListSkeleton count={5} />
  ) : (
    <SubscriptionList subscriptions={subscriptions} />
  );
}
```

### Gesture Interactions

```tsx
import { SwipeableSubscriptionCard } from '../animations';

<SwipeableSubscriptionCard
  leftAction={{ label: 'Delete', color: 'red' }}
  rightAction={{ label: 'Edit', color: 'blue' }}
  onSwipeLeft={handleDelete}
  onSwipeRight={handleEdit}>
  <YourCardContent />
</SwipeableSubscriptionCard>;
```

## Animation Presets

### Timing Configurations

- `fast`: 200ms - Quick interactions
- `normal`: 300ms - Standard transitions
- `slow`: 500ms - Dramatic effects

### Easing Functions

- `easeInOut`: Smooth acceleration/deceleration
- `easeOut`: Quick start, smooth finish
- `easeIn`: Smooth start, quick finish
- `bounce`: Playful bouncing effect
- `elastic`: Elastic spring effect

## Performance Best Practices

1. **Use Native Drivers**: All animations use `useNativeDriver: true` for optimal performance
2. **Batch Animations**: Group related animations to prevent layout thrashing
3. **Memory Management**: Clean up animation references to prevent memory leaks
4. **Power Awareness**: Adjust animation complexity based on device power state
5. **Stagger Large Lists**: Use staggered animations for long lists to maintain smooth scrolling

## Testing

The animation system includes comprehensive tests covering:

- Component rendering with animations
- Gesture handling and interactions
- Animation lifecycle management
- Performance optimization utilities
- Shared element transitions

Run tests with:

```bash
npm test src/animations/
```

## Integration

The animation system is fully integrated into the existing SubTrackr architecture:

- **HomeScreen**: Uses `ScreenTransition` and `StaggeredList` for smooth loading
- **SubscriptionDetailScreen**: Implements shared element transitions
- **SubscriptionList**: Enhanced with loading skeletons and animated cards
- **Navigation**: Supports cross-screen shared element transitions

## Future Enhancements

- [ ] Lottie animation integration for complex illustrations
- [ ] Theme-based animation configurations
- [ ] Accessibility animation preferences
- [ ] Animation analytics and user behavior tracking
- [ ] Advanced gesture recognition (pinch, rotate)
- [ ] Haptic feedback integration
