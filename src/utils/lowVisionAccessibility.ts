export interface LowVisionConfig {
  enabled: boolean;
  fontScale: number; // 1.0 to 2.0
  highContrast: boolean;
  minTouchTargetSize: number; // minimum 56pt when low vision mode is active
}

export const DEFAULT_LOW_VISION_CONFIG: LowVisionConfig = {
  enabled: false,
  fontScale: 1.0,
  highContrast: false,
  minTouchTargetSize: 44,
};

export const ACTIVE_LOW_VISION_CONFIG: LowVisionConfig = {
  enabled: true,
  fontScale: 1.5,
  highContrast: true,
  minTouchTargetSize: 56,
};

export const HIGH_CONTRAST_PALETTE = {
  background: '#000000',
  surface: '#121212',
  text: '#FFFFFF',
  textSecondary: '#E0E0E0',
  primary: '#FFFF00', // High contrast yellow
  secondary: '#00FFFF', // High contrast cyan
  border: '#FFFFFF',
  error: '#FF3333',
  success: '#00FF66',
};

/**
 * Calculates scaled font size for low vision readability
 */
export function getScaledFontSize(baseSize: number, fontScale: number = 1.0): number {
  const scale = Math.max(1.0, Math.min(2.0, fontScale));
  return Math.round(baseSize * scale);
}

/**
 * Ensures touch target meets accessibility requirements (56pt for low vision mode)
 */
export function getAccessibleTouchTarget(
  minSize: number = 56
): { minWidth: number; minHeight: number; padding: number } {
  const size = Math.max(44, minSize);
  return {
    minWidth: size,
    minHeight: size,
    padding: Math.max(8, Math.round((size - 40) / 2)),
  };
}

/**
 * Generates low vision accessible style properties
 */
export function getLowVisionStyles(config: LowVisionConfig) {
  const fontScale = config.enabled ? Math.max(1.25, config.fontScale) : config.fontScale;
  const touchTarget = config.enabled ? Math.max(56, config.minTouchTargetSize) : config.minTouchTargetSize;

  return {
    fontScale,
    touchTargetSize: touchTarget,
    palette: config.highContrast || (config.enabled && config.highContrast) ? HIGH_CONTRAST_PALETTE : null,
    touchStyle: getAccessibleTouchTarget(touchTarget),
  };
}
