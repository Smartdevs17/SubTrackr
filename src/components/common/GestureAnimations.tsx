import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { colors, spacing } from '../../utils/constants';
import { animations, useAnimatedValue } from '../../utils/animations';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;

interface SwipeableSubscriptionCardProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftAction?: {
    label: string;
    color: string;
    icon?: string;
  };
  rightAction?: {
    label: string;
    color: string;
    icon?: string;
  };
}

export const SwipeableSubscriptionCard: React.FC<SwipeableSubscriptionCardProps> = ({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftAction,
  rightAction,
}) => {
  const pan = useRef(new Animated.ValueXY()).current;
  const bounceAnim = useAnimatedValue(1);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {},
      onPanResponderMove: Animated.event([null, { dx: pan.x }], { useNativeDriver: false }),
      onPanResponderRelease: (evt, gestureState) => {
        const { dx, vx } = gestureState;

        // Determine swipe direction and velocity
        const isLeftSwipe = dx < -SWIPE_THRESHOLD || vx < -0.5;
        const isRightSwipe = dx > SWIPE_THRESHOLD || vx > 0.5;

        if (isLeftSwipe && onSwipeLeft) {
          // Swipe left action
          Animated.spring(pan, {
            toValue: { x: -SCREEN_WIDTH, y: 0 },
            useNativeDriver: false,
          }).start(() => {
            onSwipeLeft();
            // Reset position after action
            pan.setValue({ x: 0, y: 0 });
          });
        } else if (isRightSwipe && onSwipeRight) {
          // Swipe right action
          Animated.spring(pan, {
            toValue: { x: SCREEN_WIDTH, y: 0 },
            useNativeDriver: false,
          }).start(() => {
            onSwipeRight();
            // Reset position after action
            pan.setValue({ x: 0, y: 0 });
          });
        } else {
          // Return to original position
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
        }).start();
      },
    })
  ).current;

  const animatedCardStyle = {
    transform: [{ translateX: pan.x }, { scale: bounceAnim }],
  };

  const leftActionStyle = {
    opacity: pan.x.interpolate({
      inputRange: [-SCREEN_WIDTH, -50, 0],
      outputRange: [1, 0.5, 0],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        translateX: pan.x.interpolate({
          inputRange: [-SCREEN_WIDTH, 0],
          outputRange: [0, -SCREEN_WIDTH / 2],
          extrapolate: 'clamp',
        }),
      },
    ],
  };

  const rightActionStyle = {
    opacity: pan.x.interpolate({
      inputRange: [0, 50, SCREEN_WIDTH],
      outputRange: [0, 0.5, 1],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        translateX: pan.x.interpolate({
          inputRange: [0, SCREEN_WIDTH],
          outputRange: [SCREEN_WIDTH / 2, 0],
          extrapolate: 'clamp',
        }),
      },
    ],
  };

  return (
    <View style={styles.container}>
      {/* Left Action Background */}
      {leftAction && (
        <Animated.View style={[styles.actionBackground, styles.leftAction, leftActionStyle]}>
          <View style={[styles.actionContent, { backgroundColor: leftAction.color }]}>
            {leftAction.icon && <Text style={styles.actionIcon}>{leftAction.icon}</Text>}
            <Text style={styles.actionLabel}>{leftAction.label}</Text>
          </View>
        </Animated.View>
      )}

      {/* Right Action Background */}
      {rightAction && (
        <Animated.View style={[styles.actionBackground, styles.rightAction, rightActionStyle]}>
          <View style={[styles.actionContent, { backgroundColor: rightAction.color }]}>
            {rightAction.icon && <Text style={styles.actionIcon}>{rightAction.icon}</Text>}
            <Text style={styles.actionLabel}>{rightAction.label}</Text>
          </View>
        </Animated.View>
      )}

      {/* Main Card */}
      <Animated.View style={[styles.card, animatedCardStyle]} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
};

interface GestureDrivenCardProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  onDoubleTap?: () => void;
}

export const GestureDrivenCard: React.FC<GestureDrivenCardProps> = ({
  children,
  onPress,
  onLongPress,
  onDoubleTap,
}) => {
  const scaleAnim = useAnimatedValue(1);
  const rotateAnim = useAnimatedValue(0);
  const lastTapRef = useRef<number>(0);

  const handlePress = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;

    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double tap detected
      if (onDoubleTap) {
        animations.bounce(scaleAnim).start(onDoubleTap);
      }
    } else {
      // Single tap
      if (onPress) {
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
        ]).start(onPress);
      }
    }

    lastTapRef.current = now;
  };

  const handleLongPress = () => {
    if (onLongPress) {
      // Add a rotation animation for long press
      Animated.sequence([
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(rotateAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(onLongPress);
    }
  };

  const animatedStyle = {
    transform: [
      { scale: scaleAnim },
      {
        rotate: rotateAnim.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '5deg'],
        }),
      },
    ],
  };

  return (
    <Animated.View style={animatedStyle}>
      {React.cloneElement(children as React.ReactElement<any>, {
        onPress: handlePress,
        onLongPress: handleLongPress,
        delayLongPress: 500,
      })}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    marginBottom: spacing.md,
  },
  card: {
    zIndex: 2,
  },
  actionBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SCREEN_WIDTH,
    justifyContent: 'center',
    zIndex: 1,
  },
  leftAction: {
    left: 0,
  },
  rightAction: {
    right: 0,
  },
  actionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    paddingHorizontal: spacing.lg,
  },
  actionIcon: {
    fontSize: 24,
    color: colors.onPrimary,
    marginRight: spacing.sm,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.onPrimary,
  },
});
