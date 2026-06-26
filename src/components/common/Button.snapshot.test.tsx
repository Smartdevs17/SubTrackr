import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import { Button } from './Button';

describe('Button (snapshot)', () => {
  it('renders default primary button', () => {
    const { toJSON } = render(<Button title="Save" onPress={jest.fn()} />);
    expect(toJSON()).toMatchSnapshot({ platform: Platform.OS });
  });

  it('renders disabled state', () => {
    const { toJSON } = render(<Button title="Save" onPress={jest.fn()} disabled />);
    expect(toJSON()).toMatchSnapshot({ platform: Platform.OS });
  });
});

