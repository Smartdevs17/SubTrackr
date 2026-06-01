import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Animated } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows } from '../../utils/constants';
import { Subscription } from '../../types/subscription';
import {
  formatCurrency,
  formatCategory,
  formatBillingCycle,
  formatRelativeDate,
} from '../../utils/formatting';
import {
  getCategoryIcon,
  getStatusColor,
  getBillingCycleColor,
  isUpcomingBilling,
} from '../../utils/subscriptionHelpers';
import {
  animations,
  useAnimatedValue,
  createAnimatedStyle,
  SharedElementTransition,
} from '../../utils/animations';

export interface AnimatedSubscriptionCardProps {
  subscription: Subscription;
  onPress: (subscription: Subscription) => void;
  onToggleStatus?: (id: string) => void;
  index?: number;
  isVisible?: boolean;
  sharedElementId?: string;
}

export const AnimatedSubscriptionCard: React.FC<AnimatedSubscriptionCardProps> = ({
  subscription,
  onPress,
  onToggleStatus,
  index = 0,
  isVisible = true,
  sharedElementId,
}) => {
  const [previousPrice, setPreviousPrice] = useState(subscription.price);
  const [isAnimating, setIsAnimating] = useState(false);

  // Animation values
  const enterAnim = useAnimatedValue(0);
  const scaleAnim = useAnimatedValue(1);
  const priceAnim = useAnimatedValue(0);
  const statusAnim = useAnimatedValue(subscription.isActive ? 1 : 0);

  // Shared element transition
  const fallbackSharedElementAnim = useAnimatedValue(1);
  const sharedElementAnim = sharedElementId
    ? SharedElementTransition.register(sharedElementId, 1)
    : fallbackSharedElementAnim;

  useEffect(() => {
    // Enter animation with stagger
    const delay = index * 100;
    setTimeout(() => {
      animations.fadeIn(enterAnim, 400).start();
    }, delay);

    return () => {
      if (sharedElementId) {
        SharedElementTransition.unregister(sharedElementId);
      }
    };
  }, [enterAnim, index, sharedElementId]);

  // Price change animation
  useEffect(() => {
    if (previousPrice !== subscription.price) {
      setIsAnimating(true);
      animations.bounce(priceAnim).start(() => {
        setIsAnimating(false);
        setPreviousPrice(subscription.price);
      });
    }
  }, [subscription.price, previousPrice, priceAnim]);

  // Status change animation
  useEffect(() => {
    const targetValue = subscription.isActive ? 1 : 0;
    Animated.timing(statusAnim, {
      toValue: targetValue,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [subscription.isActive, statusAnim]);

  // Visibility animation
  useEffect(() => {
    if (isVisible) {
      animations.scaleIn(scaleAnim).start();
    } else {
      animations.scaleOut(scaleAnim, 200).start();
    }
  }, [isVisible, scaleAnim]);

  const handleToggleStatus = () => {
    if (onToggleStatus) {
      Alert.alert(
        subscription.isActive ? 'Pause Subscription' : 'Activate Subscription',
        `Are you sure you want to ${subscription.isActive ? 'pause' : 'activate'} ${subscription.name}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', onPress: () => onToggleStatus(subscription.id) },
        ]
      );
    }
  };

  const handlePress = () => {
    // Add press animation
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onPress(subscription);
    });
  };

  const upcoming = isUpcomingBilling(subscription.nextBillingDate);

  const animatedCardStyle = {
    ...createAnimatedStyle.fade(enterAnim),
    ...createAnimatedStyle.scale(scaleAnim),
    ...createAnimatedStyle.scaleAndFade(sharedElementAnim),
  };

  const animatedPriceStyle = {
    ...createAnimatedStyle.bounceScale(priceAnim),
  };

  const animatedStatusStyle = {
    opacity: statusAnim,
    transform: [
      {
        scale: statusAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.8, 1],
        }),
      },
    ],
  };

  return (
    <Animated.View
      style={[styles.container, animatedCardStyle, upcoming && styles.upcomingContainer]}>
      <TouchableOpacity
        testID={`subscription-card-${subscription.id}`}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`${subscription.name}, ${formatCurrency(
          subscription.price,
          subscription.currency
        )} per ${formatBillingCycle(subscription.billingCycle)}, ${
          subscription.isActive ? 'Active' : 'Paused'
        }`}
        style={styles.touchable}
        onPress={handlePress}
        activeOpacity={0.8}>
        <View style={styles.header}>
          <Animated.View style={[styles.iconContainer, animatedStatusStyle]}>
            <Text style={styles.icon}>{getCategoryIcon(subscription.category)}</Text>
          </Animated.View>

          <View style={styles.titleContainer}>
            <Text
              testID={`subscription-name-${subscription.id}`}
              style={styles.name}
              numberOfLines={1}>
              {subscription.name}
            </Text>
            <Text style={styles.category} numberOfLines={1}>
              {formatCategory(subscription.category)}
            </Text>
          </View>

          <Animated.View
            accessible={true}
            accessibilityLabel={
              subscription.isActive ? 'Subscription active' : 'Subscription paused'
            }
            style={[styles.statusContainer, animatedStatusStyle]}>
            <View
              style={[
                styles.statusIndicator,
                { backgroundColor: getStatusColor(subscription.isActive) },
              ]}
            />
            {subscription.isCryptoEnabled && (
              <Animated.View style={[styles.cryptoBadge, animatedStatusStyle]}>
                <Text style={styles.cryptoText}>₿</Text>
              </Animated.View>
            )}
          </Animated.View>
        </View>

        <View style={styles.details}>
          <Animated.View
            accessible={true}
            accessibilityLabel={`Price ${formatCurrency(
              subscription.price,
              subscription.currency
            )} per ${formatBillingCycle(subscription.billingCycle)}`}
            style={[styles.priceContainer, isAnimating && animatedPriceStyle]}>
            <Text style={styles.price}>
              {formatCurrency(subscription.price, subscription.currency)}
            </Text>
            <Text
              style={[
                styles.billingCycle,
                { color: getBillingCycleColor(subscription.billingCycle) },
              ]}>
              /{formatBillingCycle(subscription.billingCycle)}
            </Text>
          </Animated.View>

          <View style={styles.billingInfo}>
            <Text style={styles.billingLabel}>Next billing:</Text>
            <Text
              style={[styles.billingDate, upcoming && styles.upcomingDate]}
              accessibilityLabel={`Next billing date ${formatRelativeDate(
                new Date(subscription.nextBillingDate)
              )}`}>
              {formatRelativeDate(new Date(subscription.nextBillingDate))}
            </Text>
          </View>
        </View>

        {subscription.description && (
          <Text style={styles.description} numberOfLines={2}>
            {subscription.description}
          </Text>
        )}

        {onToggleStatus && (
          <TouchableOpacity
            style={styles.toggleButton}
            onPress={handleToggleStatus}
            activeOpacity={0.7}
            testID={`subscription-toggle-${subscription.id}`}
            accessibilityRole="button"
            accessibilityLabel={
              subscription.isActive ? `Pause ${subscription.name}` : `Activate ${subscription.name}`
            }>
            <Text style={styles.toggleText}>{subscription.isActive ? 'Pause' : 'Activate'}</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  touchable: {
    flex: 1,
  },
  upcomingContainer: {
    borderWidth: 2,
    borderColor: colors.warning,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  icon: {
    fontSize: 20,
    color: colors.onPrimary,
  },
  titleContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  name: {
    ...typography.h3,
    color: colors.onSurface,
    marginBottom: 2,
  },
  category: {
    ...typography.caption,
    color: colors.onSurfaceVariant,
  },
  statusContainer: {
    alignItems: 'center',
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginBottom: 4,
  },
  cryptoBadge: {
    backgroundColor: colors.secondary,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  cryptoText: {
    ...typography.caption,
    color: colors.onSecondary,
    fontWeight: 'bold',
  },
  details: {
    marginBottom: spacing.sm,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.xs,
  },
  price: {
    ...typography.h2,
    color: colors.onSurface,
    fontWeight: 'bold',
  },
  billingCycle: {
    ...typography.body2,
    marginLeft: 4,
  },
  billingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  billingLabel: {
    ...typography.caption,
    color: colors.onSurfaceVariant,
    marginRight: spacing.xs,
  },
  billingDate: {
    ...typography.body2,
    color: colors.onSurface,
  },
  upcomingDate: {
    color: colors.warning,
    fontWeight: 'bold',
  },
  description: {
    ...typography.body2,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.sm,
  },
  toggleButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  toggleText: {
    ...typography.button,
    color: colors.onPrimary,
    fontWeight: 'bold',
  },
});
