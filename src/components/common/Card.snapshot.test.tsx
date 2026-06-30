import React from 'react';
import { Platform, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { Card } from './Card';
import { ThemeProvider } from '../../context/ThemeContext';

describe('Card (snapshot)', () => {
  it('renders default card with children', () => {
    const { toJSON } = render(
      <ThemeProvider>
        <Card accessibilityLabel="test-card">
          <Text>Card content</Text>
        </Card>
      </ThemeProvider>
    );

    expect(toJSON()).toMatchSnapshot({ platform: Platform.OS });
  });
});
