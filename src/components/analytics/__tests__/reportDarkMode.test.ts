import { renderHook } from '@testing-library/react-hooks';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useThemeStore } from '../../../theme/themeStore';

describe('Report Dark Mode Support (Issue #1276)', () => {
  beforeEach(() => {
    useThemeStore.getState().setThemeMode('light');
  });

  it('resolves light mode colors for reports', () => {
    const { result } = renderHook(() => useThemeColors());
    expect(result.current.background).toBeDefined();
    expect(result.current.textPrimary).toBeDefined();
  });

  it('resolves dark mode background and text colors for reports', () => {
    useThemeStore.getState().setThemeMode('dark');
    const { result } = renderHook(() => useThemeColors());

    expect(result.current.background).toContain('#');
    expect(result.current.textPrimary).toContain('#');
    expect(result.current.card).toBeDefined();
    expect(result.current.status.success).toBeDefined();
    expect(result.current.status.error).toBeDefined();
  });

  it('toggles smoothly between light and dark themes for report components', () => {
    const { result, rerender } = renderHook(() => useThemeColors());
    const lightBg = result.current.background;

    useThemeStore.getState().setThemeMode('dark');
    rerender();
    const darkBg = result.current.background;

    expect(darkBg).not.toEqual(lightBg);
  });
});
