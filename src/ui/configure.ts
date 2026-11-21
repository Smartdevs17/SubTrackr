/**
 * Connects @subtrackr/ui to the app's theme. Imported (for its side effect)
 * by the re-export shims in src/components/common so any screen that renders
 * a shared component gets the app's colours.
 */
import { configureUI } from '../../packages/ui/src/theme';
import { useThemeColors } from '../hooks/useThemeColors';

configureUI({ useColors: useThemeColors });
