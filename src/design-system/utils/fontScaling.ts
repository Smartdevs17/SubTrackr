/**
 * Font Scaling and Text Size Utilities
 * Handles responsive font scaling and WCAG compliance
 */

/**
 * Calculate responsive font size based on screen width
 * Uses a modular scale for better typography
 */
export const calculateResponsiveFontSize = (
  baseFontSize: number,
  screenWidth: number,
  minSize: number = baseFontSize * 0.8,
  maxSize: number = baseFontSize * 1.2
): number => {
  // Scale factor based on screen width
  // Small: -20%, Medium: 0%, Large: +20%
  const scale = (screenWidth - 320) / 680; // Normalize between -1 and 1 approximately
  const scaledSize = baseFontSize * (1 + scale * 0.2);

  // Clamp between min and max
  return Math.max(minSize, Math.min(maxSize, scaledSize));
};

/**
 * Get font scale multiplier
 * Returns a multiplier for font sizes based on accessibility settings
 */
export const getFontScaleMultiplier = (): number => {
  // In a real app, this would be integrated with OS font scaling
  // For React Native, this is typically handled by maxFontSizeMultiplier prop
  return 1.0;
};

/**
 * WCAG 2.1 AA minimum font sizes
 * https://www.w3.org/WAI/WCAG21/Understanding/target-size.html
 */
export const WCAG_MINIMUM_FONT_SIZE = {
  body: 14, // Minimum for body text
  button: 12, // Minimum for buttons
  caption: 12, // Minimum for captions
} as const;

/**
 * Max font scale multiplier for accessibility
 * Prevents text from becoming too large
 */
export const MAX_FONT_SCALE_MULTIPLIER = 1.2;

/**
 * Check if font size meets WCAG requirements
 */
export const meetsWCAGMinimumSize = (
  fontSize: number,
  type: 'body' | 'button' | 'caption' = 'body'
): boolean => {
  return fontSize >= WCAG_MINIMUM_FONT_SIZE[type];
};

/**
 * Validate font sizes across typography scale
 * Returns array of violations if any
 */
export interface FontSizeViolation {
  style: string;
  fontSize: number;
  minimum: number;
}

export const validateFontSizes = (
  typographyScale: Record<string, { fontSize: number }>
): FontSizeViolation[] => {
  const violations: FontSizeViolation[] = [];

  Object.entries(typographyScale).forEach(([styleName, style]) => {
    const { fontSize } = style as { fontSize: number };
    let minimum = WCAG_MINIMUM_FONT_SIZE.body;

    if (styleName.includes('button')) {
      minimum = WCAG_MINIMUM_FONT_SIZE.button;
    } else if (styleName.includes('caption')) {
      minimum = WCAG_MINIMUM_FONT_SIZE.caption;
    }

    if (fontSize < minimum) {
      violations.push({
        style: styleName,
        fontSize,
        minimum,
      });
    }
  });

  return violations;
};
