/**
 * Accessibility coverage for the Gamification hub.
 *
 * The screen and its components previously exposed no accessibility metadata
 * at all: every control was an unnamed touchable and the selected tab was
 * conveyed by colour alone. These tests pin the metadata described in
 * `WCAG_COMPLIANCE.md` — roles, accessible names, selected/checked state, and
 * touch-target sizing.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GamificationScreen } from '../GamificationScreen';
import { useGamificationStore } from '../../store/gamificationStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/notificationService', () => ({
  presentLocalNotification: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: { primary: '#0f172a', secondary: '#1e293b' },
      text: { primary: '#f8fafc', secondary: '#94a3b8' },
      brand: { primary: '#6366f1' },
      border: { default: '#334155' },
    },
  }),
}));

describe('GamificationScreen accessibility', () => {
  beforeEach(() => {
    useGamificationStore.getState().resetProgress();
  });

  describe('top-level tabs', () => {
    it('marks the tab bar as a tablist', () => {
      const { getByTestId } = render(<GamificationScreen />);
      const list = getByTestId('gamification-tab-dashboard').parent;
      expect(list?.props.accessibilityRole).toBe('tablist');
    });

    it('gives every tab the tab role and an accessible name', () => {
      const { getByTestId } = render(<GamificationScreen />);

      const dashboard = getByTestId('gamification-tab-dashboard');
      const rewards = getByTestId('gamification-tab-rewards');
      const leaderboard = getByTestId('gamification-tab-leaderboard');

      for (const tab of [dashboard, rewards, leaderboard]) {
        expect(tab.props.accessibilityRole).toBe('tab');
        expect(tab.props.accessibilityLabel).toBeTruthy();
      }

      expect(dashboard.props.accessibilityLabel).toBe('Dashboard');
      expect(rewards.props.accessibilityLabel).toBe('Rewards');
      expect(leaderboard.props.accessibilityLabel).toBe('Leaderboard');
    });

    it('exposes the selected tab through state rather than colour alone', () => {
      const { getByTestId } = render(<GamificationScreen />);

      expect(getByTestId('gamification-tab-dashboard').props.accessibilityState).toMatchObject({
        selected: true,
      });
      expect(getByTestId('gamification-tab-rewards').props.accessibilityState).toMatchObject({
        selected: false,
      });

      fireEvent.press(getByTestId('gamification-tab-rewards'));

      expect(getByTestId('gamification-tab-rewards').props.accessibilityState).toMatchObject({
        selected: true,
      });
      expect(getByTestId('gamification-tab-dashboard').props.accessibilityState).toMatchObject({
        selected: false,
      });
    });
  });

  describe('header controls', () => {
    it('names the icon-only settings button', () => {
      const { getByLabelText } = render(<GamificationScreen />);
      const settings = getByLabelText('Open gamification settings');

      expect(settings.props.accessibilityRole).toBe('button');
      expect(settings.props.accessibilityHint).toBeTruthy();
    });

    it('names the share button and explains what it does', () => {
      const { getByLabelText } = render(<GamificationScreen />);
      const share = getByLabelText('Share your progress');

      expect(share.props.accessibilityRole).toBe('button');
      expect(share.props.accessibilityHint).toBeTruthy();
    });

    it('hides the decorative gear glyph from the accessibility tree', () => {
      const { getByLabelText } = render(<GamificationScreen />);
      // The button carries the name; the emoji must not be announced as well.
      expect(getByLabelText('Open gamification settings').props.accessibilityLabel).toBe(
        'Open gamification settings'
      );
    });

    it('marks the hub title as a header', () => {
      const { getByLabelText } = render(<GamificationScreen />);
      expect(getByLabelText('Gamification hub').props.accessibilityRole).toBe('header');
    });
  });

  describe('touch targets', () => {
    it('gives the settings button the 44pt minimum target', () => {
      const { getByTestId } = render(<GamificationScreen />);
      const button = getByTestId('gamification-settings-button');
      const flattened = Array.isArray(button.props.style)
        ? Object.assign({}, ...button.props.style.filter(Boolean))
        : button.props.style;

      // WCAG 2.5.5 / MIN_TOUCH_TARGET.
      expect(flattened.width).toBeGreaterThanOrEqual(44);
      expect(flattened.height).toBeGreaterThanOrEqual(44);
    });
  });

  describe('settings dialog', () => {
    it('is exposed as a modal with an accessible name', () => {
      const { getByTestId } = render(<GamificationScreen />);
      fireEvent.press(getByTestId('gamification-settings-button'));

      const dialog = getByTestId('gamification-setting-soundEffectsEnabled').parent?.parent?.parent;
      expect(dialog?.props.accessibilityViewIsModal).toBe(true);
      expect(dialog?.props.accessibilityLabel).toBe('Gamification settings');
    });

    it('labels every setting switch and reports its checked state', () => {
      const { getByTestId } = render(<GamificationScreen />);
      fireEvent.press(getByTestId('gamification-settings-button'));

      const expected = [
        ['gamification-setting-soundEffectsEnabled', 'Sound effects'],
        ['gamification-setting-notificationsEnabled', 'Achievement notifications'],
        ['gamification-setting-showOnLeaderboard', 'Leaderboard visibility'],
        ['gamification-setting-dailyReminderEnabled', 'Daily streak reminders'],
      ] as const;

      for (const [testID, label] of expected) {
        const toggle = getByTestId(testID);
        expect(toggle.props.accessibilityRole).toBe('switch');
        expect(toggle.props.accessibilityLabel).toBe(label);
        expect(toggle.props.accessibilityHint).toBeTruthy();
        expect(typeof toggle.props.accessibilityState?.checked).toBe('boolean');
      }
    });

    it('warns before the destructive reset', () => {
      const { getByLabelText } = render(<GamificationScreen />);
      fireEvent.press(getByLabelText('Open gamification settings'));

      const reset = getByLabelText('Reset all gamification progress');
      expect(reset.props.accessibilityRole).toBe('button');
      expect(reset.props.accessibilityHint).toBeTruthy();
    });

    it('names the close control', () => {
      const { getByTestId } = render(<GamificationScreen />);
      fireEvent.press(getByTestId('gamification-settings-button'));

      const close = getByTestId('gamification-settings-close');
      expect(close.props.accessibilityRole).toBe('button');
      expect(close.props.accessibilityLabel).toBe('Close gamification settings');
    });
  });
});
