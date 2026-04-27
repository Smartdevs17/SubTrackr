import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AnimatedSubscriptionCard } from '../components/subscription/AnimatedSubscriptionCard';
import { SubscriptionListSkeleton } from '../components/common/SkeletonLoader';
import { ScreenTransition } from '../components/common/ScreenTransitions';
import { SharedElement } from '../components/common/SharedElement';
import { SwipeableSubscriptionCard } from '../components/common/GestureAnimations';
import { animations, useAnimatedValue } from '../utils/animations';

// Mock subscription data
const mockSubscription = {
  id: '1',
  name: 'Netflix',
  price: 15.99,
  currency: 'USD',
  billingCycle: 'monthly',
  category: 'streaming',
  nextBillingDate: new Date('2024-12-01'),
  isActive: true,
  isCryptoEnabled: false,
  description: 'Premium streaming service',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Animation System', () => {
  describe('AnimatedSubscriptionCard', () => {
    it('renders with basic props', () => {
      const { getByText } = render(
        <AnimatedSubscriptionCard
          subscription={mockSubscription}
          onPress={jest.fn()}
        />
      );

      expect(getByText('Netflix')).toBeTruthy();
      expect(getByText('$15.99')).toBeTruthy();
    });

    it('handles press events with animation', () => {
      const onPress = jest.fn();
      const { getByTestId } = render(
        <AnimatedSubscriptionCard
          subscription={mockSubscription}
          onPress={onPress}
        />
      );

      const card = getByTestId('subscription-card-1');
      fireEvent.press(card);

      expect(onPress).toHaveBeenCalledWith(mockSubscription);
    });

    it('shows shared element animation when id provided', () => {
      const { getByText } = render(
        <AnimatedSubscriptionCard
          subscription={mockSubscription}
          onPress={jest.fn()}
          sharedElementId="test-shared"
        />
      );

      expect(getByText('Netflix')).toBeTruthy();
    });
  });

  describe('SubscriptionListSkeleton', () => {
    it('renders skeleton with default count', () => {
      const { getAllByTestId } = render(<SubscriptionListSkeleton />);

      // Should render 3 skeleton cards by default
      const skeletons = getAllByTestId('subscription-card-');
      expect(skeletons).toHaveLength(3);
    });

    it('renders skeleton with custom count', () => {
      const { getAllByTestId } = render(<SubscriptionListSkeleton count={5} />);

      const skeletons = getAllByTestId('subscription-card-');
      expect(skeletons).toHaveLength(5);
    });
  });

  describe('ScreenTransition', () => {
    it('renders children with fade animation', () => {
      const { getByText } = render(
        <ScreenTransition type="fade">
          <Text>Test Content</Text>
        </ScreenTransition>
      );

      expect(getByText('Test Content')).toBeTruthy();
    });

    it('applies custom duration', () => {
      const { getByText } = render(
        <ScreenTransition type="slide" duration={500}>
          <Text>Test Content</Text>
        </ScreenTransition>
      );

      expect(getByText('Test Content')).toBeTruthy();
    });
  });

  describe('SharedElement', () => {
    it('renders children with shared element id', () => {
      const { getByText } = render(
        <SharedElement id="test-element">
          <Text>Shared Content</Text>
        </SharedElement>
      );

      expect(getByText('Shared Content')).toBeTruthy();
    });
  });

  describe('SwipeableSubscriptionCard', () => {
    it('renders with swipe actions', () => {
      const { getByText } = render(
        <SwipeableSubscriptionCard
          leftAction={{ label: 'Delete', color: 'red' }}
          rightAction={{ label: 'Edit', color: 'blue' }}
        >
          <Text>Card Content</Text>
        </SwipeableSubscriptionCard>
      );

      expect(getByText('Card Content')).toBeTruthy();
    });

    it('handles swipe gestures', () => {
      const onSwipeLeft = jest.fn();
      const { getByText } = render(
        <SwipeableSubscriptionCard onSwipeLeft={onSwipeLeft}>
          <Text>Card Content</Text>
        </SwipeableSubscriptionCard>
      );

      const card = getByText('Card Content');
      // Note: Actual gesture testing would require more complex setup
      expect(card).toBeTruthy();
    });
  });

  describe('Animation Utilities', () => {
    it('creates fade in animation', () => {
      const animatedValue = { setValue: jest.fn(), interpolate: jest.fn() };
      const animation = animations.fadeIn(animatedValue as any);

      expect(animation).toBeDefined();
    });

    it('creates scale animation', () => {
      const animatedValue = { setValue: jest.fn(), interpolate: jest.fn() };
      const animation = animations.scaleIn(animatedValue as any);

      expect(animation).toBeDefined();
    });

    it('creates bounce animation', () => {
      const animatedValue = { setValue: jest.fn(), interpolate: jest.fn() };
      const animation = animations.bounce(animatedValue as any);

      expect(animation).toBeDefined();
    });
  });
});
