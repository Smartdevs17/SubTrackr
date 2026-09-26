import { Animated } from 'react-native';
import { animations, animationConfig, SharedElementTransition } from '../utils/animations';

describe('Animation System', () => {
  describe('Animation Utilities', () => {
    it('creates fade in animation', () => {
      const animatedValue = new Animated.Value(0);
      const animation = animations.fadeIn(animatedValue);

      expect(animation).toBeDefined();
    });

    it('creates scale animation', () => {
      const animatedValue = new Animated.Value(0);
      const animation = animations.scaleIn(animatedValue);

      expect(animation).toBeDefined();
    });

    it('creates bounce animation', () => {
      const animatedValue = new Animated.Value(1);
      const animation = animations.bounce(animatedValue);

      expect(animation).toBeDefined();
    });

    it('keeps shared element values addressable by id', () => {
      const value = SharedElementTransition.register('test-element', 1);

      expect(SharedElementTransition.get('test-element')).toBe(value);

      SharedElementTransition.unregister('test-element');

      expect(SharedElementTransition.get('test-element')).toBeUndefined();
    });

    it('exposes expected duration presets', () => {
      expect(animationConfig.duration.fast).toBeLessThan(animationConfig.duration.normal);
      expect(animationConfig.duration.slow).toBeGreaterThan(animationConfig.duration.normal);
    });
  });
});
