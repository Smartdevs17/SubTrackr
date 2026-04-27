import React, { useEffect } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, shadows } from '../utils/constants';
import { animations, useAnimatedValue } from '../utils/animations';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius: borderRadiusProp,
  style,
}) => {
  const animatedValue = useAnimatedValue(0);

  useEffect(() => {
    const pulseAnimation = animations.pulse(animatedValue);
    pulseAnimation.start();

    return () => {
      pulseAnimation.stop();
    };
  }, [animatedValue]);

  const animatedStyle = {
    opacity: animatedValue.interpolate({
      inputRange: [0.8, 1, 1.2],
      outputRange: [0.5, 1, 0.5],
    }),
  };

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius: borderRadiusProp || borderRadius.sm,
        },
        animatedStyle,
        style,
      ]}
    />
  );
};

interface SubscriptionCardSkeletonProps {
  style?: any;
}

export const SubscriptionCardSkeleton: React.FC<SubscriptionCardSkeletonProps> = ({ style }) => {
  const fadeAnim = useAnimatedValue(0);

  useEffect(() => {
    animations.fadeIn(fadeAnim, 600).start();
  }, [fadeAnim]);

  return (
    <Animated.View style={[styles.cardContainer, { opacity: fadeAnim }, style]}>
      <View style={styles.header}>
        <Skeleton width={40} height={40} borderRadius={20} style={styles.iconSkeleton} />
        <View style={styles.titleContainer}>
          <Skeleton width={120} height={16} style={styles.titleSkeleton} />
          <Skeleton width={80} height={12} style={styles.categorySkeleton} />
        </View>
        <Skeleton width={12} height={12} borderRadius={6} style={styles.statusSkeleton} />
      </View>

      <View style={styles.details}>
        <View style={styles.priceContainer}>
          <Skeleton width={60} height={20} style={styles.priceSkeleton} />
          <Skeleton width={40} height={14} style={styles.cycleSkeleton} />
        </View>
        <View style={styles.billingContainer}>
          <Skeleton width={70} height={12} style={styles.labelSkeleton} />
          <Skeleton width={90} height={14} style={styles.dateSkeleton} />
        </View>
      </View>

      <Skeleton width="100%" height={32} style={styles.buttonSkeleton} />
    </Animated.View>
  );
};

interface SubscriptionListSkeletonProps {
  count?: number;
  style?: any;
}

export const SubscriptionListSkeleton: React.FC<SubscriptionListSkeletonProps> = ({
  count = 3,
  style,
}) => {
  const items = Array.from({ length: count }, (_, index) => (
    <SubscriptionCardSkeleton key={index} />
  ));

  return <View style={[styles.listContainer, style]}>{items}</View>;
};

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.surfaceVariant,
  },
  cardContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  iconSkeleton: {
    marginRight: spacing.sm,
  },
  titleContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  titleSkeleton: {
    marginBottom: spacing.xs,
  },
  categorySkeleton: {
    opacity: 0.7,
  },
  statusSkeleton: {
    alignSelf: 'flex-start',
  },
  details: {
    marginBottom: spacing.sm,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.xs,
  },
  priceSkeleton: {
    marginRight: spacing.xs,
  },
  cycleSkeleton: {
    opacity: 0.8,
  },
  billingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelSkeleton: {
    marginRight: spacing.xs,
    opacity: 0.7,
  },
  dateSkeleton: {
    opacity: 0.8,
  },
  buttonSkeleton: {
    marginTop: spacing.sm,
    opacity: 0.6,
  },
  listContainer: {
    padding: spacing.sm,
  },
});
