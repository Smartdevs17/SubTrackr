/**
 * SkeletonLoader
 *
 * Reusable skeleton loading components with a linear shimmer animation.
 *
 * Architecture
 * ─────────────────────────────────────────────────────────────────
 * ShimmerEffect   — shared looping translateX animation rendered once
 *                   per skeleton block via a clipped LinearGradient.
 *                   Uses useNativeDriver: true → runs entirely on the
 *                   UI thread, zero JS-thread overhead.
 *
 * Skeleton        — base block (width / height / borderRadius props).
 *
 * Composite skeletons that mirror real layouts:
 *   SubscriptionCardSkeleton   — mirrors SubscriptionCard
 *   SubscriptionListSkeleton   — N × SubscriptionCardSkeleton
 *   StatsCardSkeleton          — mirrors the 3-card StatsCard row
 *   SubscriptionDetailSkeleton — mirrors SubscriptionDetailScreen
 */

import React, { useEffect, useRef } from 'react';
import { Animated, DimensionValue, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, borderRadius, shadows } from '../../utils/constants';
import { useThemeColors } from '../../hooks/useThemeColors';

// ─── Shimmer width multiplier ─────────────────────────────────────────────────
// The gradient travels from -SHIMMER_WIDTH to +containerWidth so it always
// enters from the left and exits to the right regardless of block size.
const SHIMMER_WIDTH = 200;
const SHIMMER_DURATION = 1200; // ms per loop

// ─── ShimmerEffect ────────────────────────────────────────────────────────────

interface ShimmerEffectProps {
  width: DimensionValue;
  height: number;
  baseColor: string;
  highlightColor: string;
}

const ShimmerEffect: React.FC<ShimmerEffectProps> = ({
  width,
  height: _height,
  baseColor,
  highlightColor,
}) => {
  const translateX = useRef(new Animated.Value(-SHIMMER_WIDTH)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(translateX, {
        toValue: typeof width === 'number' ? width + SHIMMER_WIDTH : 400,
        duration: SHIMMER_DURATION,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [translateX, width]);
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
        <LinearGradient
          colors={[baseColor, highlightColor, baseColor]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ width: SHIMMER_WIDTH, height: '100%' }}
        />
      </Animated.View>
    </View>
  );
};

// ─── Skeleton (base block) ────────────────────────────────────────────────────

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius: borderRadiusProp,
  style,
}) => {
  const colors = useThemeColors();

  const baseColor = colors.background.secondary;
  // Detect dark theme at runtime: secondary background is '#111111' in dark,
  // '#F5F5F5' in light. Cast to string to avoid the literal-type comparison
  // error that TypeScript raises when comparing against the light-theme literal.
  const isDark = (colors.background.secondary as string) === '#111111';
  const highlightColor = isDark
    ? 'rgba(255,255,255,0.08)' // dark theme
    : 'rgba(255,255,255,0.7)'; // light theme

  const resolvedRadius = borderRadiusProp ?? borderRadius.sm;

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: resolvedRadius,
          backgroundColor: baseColor,
          overflow: 'hidden',
        },
        style,
      ]}>
      <ShimmerEffect
        width={width}
        height={height}
        baseColor={baseColor}
        highlightColor={highlightColor}
      />
    </View>
  );
};

// ─── SubscriptionCardSkeleton ─────────────────────────────────────────────────

interface SubscriptionCardSkeletonProps {
  style?: ViewStyle;
}

export const SubscriptionCardSkeleton: React.FC<SubscriptionCardSkeletonProps> = ({ style }) => {
  const colors = useThemeColors();

  return (
    <View
      style={[
        {
          backgroundColor: colors.background.card,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          marginBottom: spacing.md,
          ...shadows.sm,
        },
        style,
      ]}>
      {/* Row 1: icon + title + status dot */}
      <View style={skeletonStyles.row}>
        <Skeleton width={40} height={40} borderRadius={20} style={{ marginRight: spacing.sm }} />
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Skeleton width={130} height={16} style={{ marginBottom: spacing.xs }} />
          <Skeleton width={80} height={12} />
        </View>
        <Skeleton width={12} height={12} borderRadius={6} />
      </View>

      {/* Row 2: price + billing cycle */}
      <View style={[skeletonStyles.row, { marginTop: spacing.sm }]}>
        <Skeleton width={64} height={20} style={{ marginRight: spacing.xs }} />
        <Skeleton width={48} height={14} />
      </View>

      {/* Row 3: next billing label + date */}
      <View style={[skeletonStyles.row, { marginTop: spacing.xs }]}>
        <Skeleton width={72} height={12} style={{ marginRight: spacing.xs }} />
        <Skeleton width={96} height={12} />
      </View>

      {/* Row 4: action button placeholder */}
      <Skeleton
        width="100%"
        height={36}
        borderRadius={borderRadius.md}
        style={{ marginTop: spacing.md }}
      />
    </View>
  );
};

// ─── SubscriptionListSkeleton ─────────────────────────────────────────────────

interface SubscriptionListSkeletonProps {
  count?: number;
  style?: ViewStyle;
}

export const SubscriptionListSkeleton: React.FC<SubscriptionListSkeletonProps> = ({
  count = 4,
  style,
}) => (
  <View style={[{ padding: spacing.lg, paddingTop: 0 }, style]}>
    {/* Section header placeholder */}
    <View style={[skeletonStyles.row, { marginBottom: spacing.md }]}>
      <Skeleton width={160} height={20} borderRadius={borderRadius.sm} />
    </View>
    {Array.from({ length: count }, (_, i) => (
      <SubscriptionCardSkeleton key={i} />
    ))}
  </View>
);

// ─── StatsCardSkeleton ────────────────────────────────────────────────────────

export const StatsCardSkeleton: React.FC = () => {
  const colors = useThemeColors();

  const card = (flex: number) => (
    <View
      style={{
        flex,
        backgroundColor: colors.background.card,
        borderRadius: borderRadius.lg,
        padding: spacing.md,
        minHeight: 90,
        alignItems: 'center',
        justifyContent: 'center',
        ...shadows.sm,
      }}>
      <Skeleton width={48} height={11} style={{ marginBottom: spacing.xs }} />
      <Skeleton width={64} height={22} />
    </View>
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        paddingHorizontal: spacing.lg,
        marginVertical: spacing.md,
        gap: spacing.sm,
      }}>
      {card(1.2)}
      {card(1)}
      {card(1)}
    </View>
  );
};

// ─── SubscriptionDetailSkeleton ───────────────────────────────────────────────

export const SubscriptionDetailSkeleton: React.FC = () => {
  const colors = useThemeColors();

  const cardStyle: ViewStyle = {
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    ...shadows.sm,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background.primary }}>
      {/* Header row: back arrow + title + edit */}
      <View style={[skeletonStyles.row, { padding: spacing.lg, justifyContent: 'space-between' }]}>
        <Skeleton width={32} height={32} borderRadius={borderRadius.sm} />
        <Skeleton width={160} height={20} borderRadius={borderRadius.sm} />
        <Skeleton width={32} height={20} borderRadius={borderRadius.sm} />
      </View>

      {/* Main info card: icon + name + category */}
      <View style={cardStyle}>
        <View style={skeletonStyles.row}>
          <Skeleton width={48} height={48} borderRadius={24} style={{ marginRight: spacing.md }} />
          <View style={{ flex: 1 }}>
            <Skeleton width={160} height={22} style={{ marginBottom: spacing.xs }} />
            <Skeleton width={80} height={13} />
          </View>
        </View>
        <Skeleton width="90%" height={14} style={{ marginTop: spacing.md }} />
      </View>

      {/* Pricing card */}
      <View style={cardStyle}>
        <Skeleton width={56} height={13} style={{ marginBottom: spacing.md }} />
        <View style={[skeletonStyles.row, { marginBottom: spacing.md }]}>
          <View style={{ flex: 1 }}>
            <Skeleton width={48} height={12} style={{ marginBottom: spacing.xs }} />
            <Skeleton width={80} height={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Skeleton width={72} height={12} style={{ marginBottom: spacing.xs }} />
            <Skeleton width={64} height={22} />
          </View>
        </View>
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingTop: spacing.md,
          }}>
          <Skeleton width={96} height={12} style={{ marginBottom: spacing.xs }} />
          <Skeleton width={200} height={16} />
        </View>
      </View>

      {/* Network & Gas card */}
      <View style={cardStyle}>
        <Skeleton width={96} height={13} style={{ marginBottom: spacing.md }} />
        {[0, 1].map((i) => (
          <View key={i} style={[skeletonStyles.spacedRow, { marginBottom: spacing.xs }]}>
            <Skeleton width={72} height={14} />
            <Skeleton width={80} height={14} />
          </View>
        ))}
      </View>

      {/* Action buttons */}
      <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
        <Skeleton width={160} height={20} style={{ marginBottom: spacing.md }} />
        <Skeleton
          width="100%"
          height={48}
          borderRadius={borderRadius.md}
          style={{ marginBottom: spacing.sm }}
        />
        <Skeleton
          width="100%"
          height={48}
          borderRadius={borderRadius.md}
          style={{ marginBottom: spacing.sm }}
        />
        <Skeleton width="100%" height={48} borderRadius={borderRadius.md} />
      </View>
    </View>
  );
};

// ─── Shared layout helpers ────────────────────────────────────────────────────

const skeletonStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spacedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
