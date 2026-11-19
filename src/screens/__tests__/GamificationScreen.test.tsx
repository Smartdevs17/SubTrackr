import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GamificationScreen } from '../GamificationScreen';
import { useGamificationStore } from '../../store/gamificationStore';

// Mock dependencies
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

describe('GamificationScreen', () => {
  beforeEach(() => {
    useGamificationStore.getState().resetProgress();
  });

  it('renders Gamification Hub header and user stats bar', () => {
    const { getByText } = render(<GamificationScreen />);
    expect(getByText('🎮 Gamification Hub')).toBeTruthy();
    expect(getByText('Earn XP, unlock rewards, and compete!')).toBeTruthy();
  });

  it('switches navigation tabs (Dashboard, Rewards, Leaderboard)', () => {
    const { getByTestId, getByText } = render(<GamificationScreen />);

    // The tab label and the leaderboard heading are both "🏆 Leaderboard", so
    // drive the tabs by testID and assert the tab body by its own text.
    fireEvent.press(getByTestId('gamification-tab-rewards'));
    expect(
      getByText(
        'No rewards unlocked yet. Complete achievements to earn discounts and loyalty credits!'
      )
    ).toBeTruthy();

    fireEvent.press(getByTestId('gamification-tab-leaderboard'));
    // The leaderboard body renders its category filter; the "🏆 Leaderboard"
    // heading is shared with the tab label, so assert on the filter instead.
    expect(getByTestId('leaderboard-category-all_time')).toBeTruthy();
  });
});
