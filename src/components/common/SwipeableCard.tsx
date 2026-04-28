import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  PanResponderGestureState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { borderRadius, colors, shadows, spacing, typography } from '../../utils/constants';
import {
  buildGestureDebugLabel,
  GestureDirection,
  resolveGesturePriority,
  triggerGestureFeedback,
  validateHorizontalSwipe,
} from '../../services/gestureService';

interface SwipeableCardProps {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  accessibilityLabel?: string;
  debugEnabled?: boolean;
}

const MAX_SWIPE_TRANSLATION = 96;

function clampTranslate(value: number): number {
  return Math.max(Math.min(value, MAX_SWIPE_TRANSLATION), -MAX_SWIPE_TRANSLATION);
}

export const SwipeableCard: React.FC<SwipeableCardProps> = ({
  children,
  onPress,
  onLongPress,
  onSwipeLeft,
  onSwipeRight,
  accessibilityLabel,
  debugEnabled = false,
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const draggingRef = useRef(false);
  const longPressTriggeredRef = useRef(false);
  const [debugLabel, setDebugLabel] = useState('gesture=tap direction=none');

  const resetPosition = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 8,
      speed: 16,
    }).start();
  };

  const completeSwipe = (direction: GestureDirection, action?: () => void) => {
    Animated.sequence([
      Animated.timing(translateX, {
        toValue: direction === 'right' ? 72 : -72,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 6,
        speed: 18,
      }),
    ]).start();

    if (action) {
      triggerGestureFeedback('success');
      action();
    }
  };

  const handleRelease = (gestureState: PanResponderGestureState) => {
    const result = validateHorizontalSwipe(gestureState);
    const priority = resolveGesturePriority(result, longPressTriggeredRef.current);

    if (debugEnabled) {
      setDebugLabel(buildGestureDebugLabel({ ...result, priority }, gestureState));
    }

    draggingRef.current = false;
    longPressTriggeredRef.current = false;

    if (priority !== 'swipe') {
      resetPosition();
      return;
    }

    if (result.direction === 'right') {
      completeSwipe('right', onSwipeRight);
      return;
    }

    if (result.direction === 'left') {
      completeSwipe('left', onSwipeLeft);
      return;
    }

    resetPosition();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onPanResponderGrant: () => {
          draggingRef.current = false;
        },
        onPanResponderMove: (_, gestureState) => {
          draggingRef.current = true;
          translateX.setValue(clampTranslate(gestureState.dx));
          if (debugEnabled) {
            const result = validateHorizontalSwipe(gestureState);
            setDebugLabel(buildGestureDebugLabel(result, gestureState));
          }
        },
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_, gestureState) => handleRelease(gestureState),
        onPanResponderTerminate: (_, gestureState) => handleRelease(gestureState),
      }),
    [debugEnabled, onSwipeLeft, onSwipeRight, translateX]
  );

  return (
    <View style={styles.wrapper}>
      <View pointerEvents="none" style={styles.actionBackground}>
        <Text style={styles.leftActionText}>Quick toggle</Text>
        <Text style={styles.rightActionText}>Open</Text>
      </View>
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.animatedCard, { transform: [{ translateX }] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          delayLongPress={320}
          onLongPress={() => {
            if (draggingRef.current) return;
            longPressTriggeredRef.current = true;
            triggerGestureFeedback('long-press');
            onLongPress?.();
            setTimeout(() => {
              longPressTriggeredRef.current = false;
            }, 700);
          }}
          onPress={() => {
            if (draggingRef.current) {
              resetPosition();
              return;
            }
            if (longPressTriggeredRef.current) {
              longPressTriggeredRef.current = false;
              return;
            }
            triggerGestureFeedback('tap');
            onPress();
          }}
          style={styles.pressable}>
          {children}
        </Pressable>
      </Animated.View>
      {debugEnabled ? (
        <View style={styles.debugBadge}>
          <Text style={styles.debugText}>{debugLabel}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
  },
  actionBackground: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
  },
  leftActionText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
  },
  rightActionText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
  animatedCard: {
    borderRadius: borderRadius.lg,
    ...shadows.sm,
  },
  pressable: {
    borderRadius: borderRadius.lg,
  },
  debugBadge: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  debugText: {
    ...typography.small,
    color: colors.textSecondary,
  },
});
