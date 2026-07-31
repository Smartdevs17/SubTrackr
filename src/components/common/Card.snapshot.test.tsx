import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { Card } from './Card';
import { ThemeProvider } from '../../context/ThemeContext';

describe('Card (snapshot)', () => {
  it('renders default card with children', () => {
    const { getByText } = render(
      <ThemeProvider>
        <Card accessibilityLabel="test-card">
          <Text>Card content</Text>
        </Card>
      </ThemeProvider>
    );

    expect(getByText('Card content')).toBeDefined();
  });
});
