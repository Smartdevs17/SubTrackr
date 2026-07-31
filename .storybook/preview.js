/**
 * Storybook Preview Configuration
 *
 * Location: .storybook/preview.js
 */

import * as React from 'react';
import { View, SafeAreaView } from 'react-native';

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
  backgrounds: {
    default: 'dark',
    values: [
      { name: 'dark', value: '#0f172a' },
      { name: 'light', value: '#f8fafc' },
      { name: 'high-contrast', value: '#000000' },
    ],
  },
  layout: 'centered',
};

export const decorators = [
  (Story) => (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
      <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
        <Story />
      </View>
    </SafeAreaView>
  ),
];

export const tags = ['autodocs'];
