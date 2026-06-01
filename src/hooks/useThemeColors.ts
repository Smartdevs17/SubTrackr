import { useTheme } from '../context/ThemeContext';
import { ColorTokens } from '../theme/colors';

export function useThemeColors(): ColorTokens {
  return useTheme().colors;
}
