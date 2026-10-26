import { useTheme } from '../context/ThemeContext';
import { ColorTokens, darkColors, lightColors } from '../theme/colors';
import { useThemeStore } from '../theme/themeStore';

export type EnhancedColorTokens = ColorTokens & {
  background: string;
  textPrimary: string;
  card: string;
};

export function useThemeColors(): EnhancedColorTokens {
  let colors: ColorTokens = lightColors;

  try {
    const themeContext = useTheme();
    colors = themeContext.colors;
  } catch {
    const storeTheme = useThemeStore.getState().theme;
    const isDark = storeTheme?.mode === 'dark';
    colors = isDark ? darkColors : lightColors;
  }

  return {
    ...colors,
    background: colors.background.primary,
    textPrimary: colors.text.primary,
    card: colors.background.card,
  };
}
