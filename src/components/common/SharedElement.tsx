import React, { useEffect } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { SharedElementTransition, animations, useAnimatedValue } from '../../utils/animations';

interface SharedElementProps {
  id: string;
  children: React.ReactNode;
  style?: any;
  transitionType?: 'fade' | 'scale' | 'slide';
}

export const SharedElement: React.FC<SharedElementProps> = ({
  id,
  children,
  style,
  transitionType = 'fade',
}) => {
  const animatedValue = SharedElementTransition.register(id, 1);
  const localAnim = useAnimatedValue(1);

  useEffect(() => {
    // Start with the shared element animation
    let animation: Animated.CompositeAnimation;

    switch (transitionType) {
      case 'scale':
        animation = animations.scaleIn(localAnim);
        break;
      case 'slide':
        animation = animations.slideInFromRight(localAnim);
        break;
      case 'fade':
      default:
        animation = animations.fadeIn(localAnim);
        break;
    }

    animation.start();

    return () => {
      SharedElementTransition.unregister(id);
    };
  }, [id, transitionType, localAnim]);

  const animatedStyle = React.useMemo(() => {
    switch (transitionType) {
      case 'scale':
        return {
          opacity: Animated.multiply(animatedValue, localAnim),
          transform: [{ scale: Animated.multiply(animatedValue, localAnim) }],
        };
      case 'slide':
        return {
          opacity: Animated.multiply(animatedValue, localAnim),
          transform: [
            {
              translateX: Animated.multiply(
                animatedValue.interpolate({ inputRange: [0, 1], outputRange: [100, 0] }),
                localAnim
              ),
            },
          ],
        };
      case 'fade':
      default:
        return {
          opacity: Animated.multiply(animatedValue, localAnim),
        };
    }
  }, [animatedValue, localAnim, transitionType]);

  return <Animated.View style={[styles.container, animatedStyle, style]}>{children}</Animated.View>;
};

interface SharedElementTransitionProviderProps {
  children: React.ReactNode;
}

export const SharedElementTransitionProvider: React.FC<SharedElementTransitionProviderProps> = ({
  children,
}) => {
  return <View style={styles.provider}>{children}</View>;
};

const styles = StyleSheet.create({
  container: {
    // Base styles for shared elements
  },
  provider: {
    flex: 1,
  },
});

export { ScreenTransition } from './ScreenTransitions';
