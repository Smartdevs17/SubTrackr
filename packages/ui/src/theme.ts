/**
 * Theme bridge for @subtrackr/ui.
 *
 * The package never imports app state. It only needs the handful of colour
 * tokens below, and the host app supplies them once with `configureUI`.
 * Without configuration (for example in Storybook) the light palette is used.
 */

export interface UIColors {
  readonly background: { readonly card: string };
  readonly text: { readonly primary: string; readonly secondary: string };
  readonly border: { readonly default: string };
  readonly brand: { readonly primary: string };
  readonly onPrimary: string;
}

export const lightUIColors: UIColors = {
  background: { card: '#FFFFFF' },
  text: { primary: '#1A1A1A', secondary: '#6B7280' },
  border: { default: '#E5E7EB' },
  brand: { primary: '#6366F1' },
  onPrimary: '#FFFFFF',
};

export const darkUIColors: UIColors = {
  background: { card: '#1A1A1A' },
  text: { primary: '#F9FAFB', secondary: '#9CA3AF' },
  border: { default: '#374151' },
  brand: { primary: '#818CF8' },
  onPrimary: '#FFFFFF',
};

export interface UIConfig {
  /** A React hook returning the current colour tokens. */
  useColors: () => UIColors;
}

let config: UIConfig = { useColors: () => lightUIColors };

/** Call once at app start-up (or in a Storybook decorator). */
export function configureUI(next: Partial<UIConfig>): void {
  config = { ...config, ...next };
}

/** Restores the default light theme. Mainly for tests. */
export function resetUI(): void {
  config = { useColors: () => lightUIColors };
}

export function useUIColors(): UIColors {
  return config.useColors();
}
