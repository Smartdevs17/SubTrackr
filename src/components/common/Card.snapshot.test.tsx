import React from 'react';
import { Platform, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { Card } from './Card';

describe('Card (snapshot)', () => {
  it('renders default card with children', () => {
    const { toJSON } = render(
      <Card accessibilityLabel="test-card">
        <Text>Card content</Text>
      </Card>
    );

    expect(toJSON()).toMatchSnapshot({ platform: Platform.OS });
  });
});

