import React from 'react';
import { act, renderHook } from '@testing-library/react-hooks/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from './ThemeContext';
import { darkColors, lightColors } from '../theme/colors';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const mockRemove = jest.fn();
const mockAddChangeListener = jest.fn(() => ({ remove: mockRemove }));
const mockGetColorScheme = jest.fn();

jest.mock('react-native/Libraries/Utilities/Appearance', () => ({
  getColorScheme: (...args: unknown[]) => mockGetColorScheme(...args),
  addChangeListener: (...args: unknown[]) => mockAddChangeListener(...args),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe('ThemeContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetColorScheme.mockReturnValue('light');
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it('defaults to system mode', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe('system');
  });

  it('resolves system light mode as not dark', async () => {
    mockGetColorScheme.mockReturnValue('light');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.isDark).toBe(false);
  });

  it('resolves system dark mode as dark', async () => {
    mockGetColorScheme.mockReturnValue('dark');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.isDark).toBe(true);
  });

  it('dark mode stays dark regardless of system', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setMode('dark');
    });

    expect(result.current.isDark).toBe(true);
  });

  it('light mode stays light regardless of system', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setMode('light');
    });

    expect(result.current.isDark).toBe(false);
  });

  it('setMode persists dark mode', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setMode('dark');
    });

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@subtrackr/theme_mode', 'dark');
    expect(result.current.isDark).toBe(true);
  });

  it('toggleTheme flips between dark and light', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setMode('dark');
    });
    act(() => {
      result.current.toggleTheme();
    });
    expect(result.current.mode).toBe('light');

    act(() => {
      result.current.toggleTheme();
    });
    expect(result.current.mode).toBe('dark');
  });

  it('loads persisted mode from storage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('dark');
    const { result } = renderHook(() => useTheme(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.mode).toBe('dark');
  });

  it('throws outside provider', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useTheme());

    expect(result.error).toEqual(new Error('useTheme must be used within a ThemeProvider'));
    consoleErrorSpy.mockRestore();
  });

  it('returns light colors in light mode', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.colors).toEqual(lightColors);
  });

  it('returns dark colors in dark mode', async () => {
    mockGetColorScheme.mockReturnValue('dark');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.colors).toEqual(darkColors);
  });

  it('removes appearance listener on unmount', async () => {
    const { unmount } = renderHook(() => useTheme(), { wrapper });
    unmount();
    expect(mockRemove).toHaveBeenCalled();
  });
});
