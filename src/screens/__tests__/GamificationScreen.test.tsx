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
    const { getByText } = render(<GamificationScreen />);
    
    // Switch to Rewards tab
    const rewardsTab = getByText(/Rewards/);
    fireEvent.press(rewardsTab);
    expect(getByText('🎁 Earned Rewards')).toBeTruthy();

    // Switch to Leaderboard tab
    const leaderboardTab = getByText('🏆 Leaderboard');
    fireEvent.press(leaderboardTab);
    expect(getByText('🏆 Community Leaderboard')).toBeTruthy();
  });
});
