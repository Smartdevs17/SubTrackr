import {
  getScaledFontSize,
  getAccessibleTouchTarget,
  getLowVisionStyles,
  DEFAULT_LOW_VISION_CONFIG,
  ACTIVE_LOW_VISION_CONFIG,
  HIGH_CONTRAST_PALETTE,
} from '../lowVisionAccessibility';

describe('Low Vision Accessibility Utils', () => {
  describe('getScaledFontSize', () => {
    test('scales base font size correctly within 1.0 to 2.0 bounds', () => {
      expect(getScaledFontSize(16, 1.0)).toBe(16);
      expect(getScaledFontSize(16, 1.5)).toBe(24);
      expect(getScaledFontSize(16, 2.0)).toBe(32);
    });

    test('clamps fontScale to range [1.0, 2.0]', () => {
      expect(getScaledFontSize(16, 0.5)).toBe(16);
      expect(getScaledFontSize(16, 2.5)).toBe(32);
    });
  });

  describe('getAccessibleTouchTarget', () => {
    test('returns minimum 56pt dimensions for low vision mode', () => {
      const target = getAccessibleTouchTarget(56);
      expect(target.minWidth).toBe(56);
      expect(target.minHeight).toBe(56);
      expect(target.padding).toBeGreaterThanOrEqual(8);
    });

    test('ensures at least 44pt for default settings', () => {
      const target = getAccessibleTouchTarget(30);
      expect(target.minWidth).toBe(44);
      expect(target.minHeight).toBe(44);
    });
  });

  describe('getLowVisionStyles', () => {
    test('returns standard configuration when disabled', () => {
      const styles = getLowVisionStyles(DEFAULT_LOW_VISION_CONFIG);
      expect(styles.fontScale).toBe(1.0);
      expect(styles.touchTargetSize).toBe(44);
      expect(styles.palette).toBeNull();
    });

    test('returns enhanced high-contrast configuration when enabled', () => {
      const styles = getLowVisionStyles(ACTIVE_LOW_VISION_CONFIG);
      expect(styles.fontScale).toBe(1.5);
      expect(styles.touchTargetSize).toBe(56);
      expect(styles.palette).toEqual(HIGH_CONTRAST_PALETTE);
    });
  });
});
