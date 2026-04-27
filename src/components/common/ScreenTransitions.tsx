import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { animations, useAnimatedValue, stagger } from '../../utils/animations';

interface ScreenTransitionProps {
  children: React.ReactNode;
  type?: 'fade' | 'slide' | 'scale' | 'stagger';
  duration?: number;
  delay?: number;
  style?: any;
}

export const ScreenTransition: React.FC<ScreenTransitionProps> = ({
  children,
  type = 'fade',
  duration = 300,
  delay = 0,
  style,
}) => {
  const animatedValue = useAnimatedValue(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!hasAnimated.current) {
      hasAnimated.current = true;

      // Start animation immediately or with minimal delay
      const startAnimation = () => {
        let animation: Animated.CompositeAnimation;

        switch (type) {
          case 'slide':
            animation = animations.slideInFromRight(animatedValue);
            break;
          case 'scale':
            animation = animations.scaleIn(animatedValue);
            break;
          case 'stagger':
            animation = animations.fadeIn(animatedValue, duration);
            break;
          case 'fade':
          default:
            animation = animations.fadeIn(animatedValue, duration);
            break;
        }

        animation.start();
      };

      if (delay > 0) {
        // Use requestAnimationFrame for smoother delays instead of setTimeout
        requestAnimationFrame(() => {
          setTimeout(startAnimation, delay);
        });
      } else {
        // Start immediately for better perceived performance
        requestAnimationFrame(startAnimation);
      }
    }
  }, [animatedValue, type, duration, delay]);

  const getAnimatedStyle = () => {
    switch (type) {
      case 'slide':
        return {
          opacity: animatedValue,
          transform: [
            {
              translateX: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: [50, 0],
              }),
            },
          ],
        };
      case 'scale':
        return {
          opacity: animatedValue,
          transform: [
            {
              scale: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: [0.9, 1],
              }),
            },
          ],
        };
      case 'fade':
      default:
        return {
          opacity: animatedValue,
        };
    }
  };

  return (
    <Animated.View style={[styles.container, getAnimatedStyle(), style]}>{children}</Animated.View>
  );
};

interface StaggeredListProps {
  children: React.ReactNode[];
  staggerDelay?: number;
  animationType?: 'fade' | 'slide' | 'scale';
  style?: any;
}

export const StaggeredList: React.FC<StaggeredListProps> = ({
  children,
  staggerDelay = 100,
  animationType = 'fade',
  style,
}) => {
  const animatedValues = React.useMemo(() => children.map(() => new Animated.Value(0)), [children]);

  useEffect(() => {
    // Start staggered animations immediately for better performance
    requestAnimationFrame(() => {
      const staggerAnimations = animatedValues.map((anim) => {
        let animation: Animated.CompositeAnimation;

        switch (animationType) {
          case 'slide':
            animation = animations.slideInFromRight(anim);
            break;
          case 'scale':
            animation = animations.scaleIn(anim);
            break;
          case 'fade':
          default:
            animation = animations.fadeIn(anim);
            break;
        }

        return animation;
      });

      stagger(staggerAnimations, staggerDelay).start();
    });
  }, [animatedValues, staggerDelay, animationType]);

  return (
    <View style={[styles.listContainer, style]}>
      {children.map((child, index) => {
        const animatedValue = animatedValues[index];
        let animatedStyle = {};

        switch (animationType) {
          case 'slide':
            animatedStyle = {
              opacity: animatedValue,
              transform: [
                {
                  translateX: animatedValue.interpolate({
                    inputRange: [0, 1],
                    outputRange: [30, 0],
                  }),
                },
              ],
            };
            break;
          case 'scale':
            animatedStyle = {
              opacity: animatedValue,
              transform: [
                {
                  scale: animatedValue.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            };
            break;
          case 'fade':
          default:
            animatedStyle = {
              opacity: animatedValue,
            };
            break;
        }

        return (
          <Animated.View key={index} style={animatedStyle}>
            {child}
          </Animated.View>
        );
      })}
    </View>
  );
};

interface TransitionGroupProps {
  children: React.ReactNode;
  appear?: boolean;
  enter?: boolean;
  exit?: boolean;
  style?: any;
}

export const TransitionGroup: React.FC<TransitionGroupProps> = ({
  children,
  appear = true,
  enter = true,
  style,
}) => {
  const animatedValue = useAnimatedValue(appear ? 0 : 1);

  useEffect(() => {
    if (enter && !appear) {
      animations.fadeIn(animatedValue).start();
    }
  }, [enter, appear, animatedValue]);

  // Note: Exit animations would need more complex state management
  // This is a simplified version

  return (
    <Animated.View style={[styles.container, { opacity: animatedValue }, style]}>
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    // Base styles for staggered lists
  },
});
