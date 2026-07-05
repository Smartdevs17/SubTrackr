import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import { SubscriptionCard } from './SubscriptionCard';
import { mockSubscription } from '../../__fixtures__/subscriptions';

// Match existing behavioural tests: SubscriptionCard depends on zustand-persist + AsyncStorage.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('SubscriptionCard (snapshot)', () => {
  it('renders active subscription card', () => {
    const { toJSON } = render(
      <SubscriptionCard subscription={mockSubscription} onPress={jest.fn()} />
    );

    expect(toJSON()).toMatchSnapshot({ platform: Platform.OS });
  });
});
