import React from 'react';
import { render } from '@testing-library/react-native';
import { AppNavigator } from '../AppNavigator';

jest.mock('../../theme', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      navigation: {
        tabBar: '#ffffff',
        tabBarBorder: '#e0e0e0',
        activeTab: '#007aff',
        inactiveTab: '#8e8e93',
      },
    },
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('AppNavigator Modular Architecture', () => {
  it('renders without crashing with feature stacks', () => {
    const { container } = render(<AppNavigator />);
    expect(container).toBeDefined();
  });
});
