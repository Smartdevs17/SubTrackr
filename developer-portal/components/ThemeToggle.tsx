import React from 'react';
import type { ThemeMode } from '../utils/themePreference';

interface ThemeToggleProps {
  mode: ThemeMode;
  onToggle: (next: ThemeMode) => void;
  /** Colors applied as inline styles so the control matches the active theme. */
  colors: { text: string; surface: string; border: string; primary: string };
}

/**
 * Accessible dark-mode switch. A labelled toggle button with aria-pressed:
 * pressed = dark mode on. Screen readers announce "Dark mode, toggle button, pressed/not pressed".
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ mode, onToggle, colors }) => {
  const isDark = mode === 'dark';

  return (
    <button
      type="button"
      aria-pressed={isDark}
      onClick={() => onToggle(isDark ? 'light' : 'dark')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        minHeight: 36,
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        color: colors.text,
        font: 'inherit',
        fontSize: 14,
        cursor: 'pointer',
      }}>
      <span aria-hidden="true">{isDark ? '☾' : '☀'}</span>
      <span>Dark mode</span>
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 18,
          borderRadius: 9,
          background: isDark ? colors.primary : colors.border,
          position: 'relative',
          display: 'inline-block',
        }}>
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: isDark ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: '#FFFFFF',
            transition: 'left 0.15s ease',
          }}
        />
      </span>
    </button>
  );
};

export default ThemeToggle;
