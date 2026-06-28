import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';

import { ThemeProvider } from '../../context/ThemeContext';

import { Button as ButtonComponent } from './Button';

jest.mock('../../hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    brand: { primary: '#000000', secondary: '#111111' },
    accent: '#222222',
    status: { error: '#ff0000' },
    onPrimary: '#ffffff',
    onSecondary: '#ffffff',
    background: { card: '#ffffff' },
    border: { default: '#cccccc' },
  }),
}));

describe('Button (snapshot)', () => {
  it('renders default primary button', () => {
    const { toJSON } = render(
      <ThemeProvider>
        <ButtonComponent title="Save" onPress={jest.fn()} />
      </ThemeProvider>
    );

    expect(toJSON()).toMatchSnapshot({ platform: Platform.OS });
  });

  it('renders disabled state', () => {
    const { toJSON } = render(
      <ThemeProvider>
        <ButtonComponent title="Save" onPress={jest.fn()} disabled />
      </ThemeProvider>
    );

    expect(toJSON()).toMatchSnapshot({ platform: Platform.OS });
  });
});
