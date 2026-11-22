import React from 'react';
import { Text, View } from 'react-native';
import { Card } from '../Card';

export default {
  title: 'Shared/Card',
  component: Card,
  parameters: {
    docs: {
      description: {
        component:
          'A theme-aware surface for grouping related content. Explore each visual variant and padding option in the controls.',
      },
    },
  },
  argTypes: {
    variant: { control: 'select', options: ['default', 'elevated', 'outlined'] },
    padding: { control: 'select', options: ['none', 'small', 'medium', 'large'] },
  },
};

const body = (
  <View>
    <Text style={{ fontSize: 16, fontWeight: '600', color: '#1A1A1A' }}>Netflix</Text>
    <Text style={{ marginTop: 4, color: '#6B7280' }}>$15.49 / month</Text>
  </View>
);

export const Default = { args: { children: body } };
export const Elevated = { args: { children: body, variant: 'elevated' } };
export const Outlined = { args: { children: body, variant: 'outlined' } };
export const NoPadding = { args: { children: body, padding: 'none' } };
export const SmallPadding = { args: { children: body, padding: 'small' } };
export const LargePadding = { args: { children: body, padding: 'large' } };

export const AllVariants = {
  render: () => (
    <View style={{ gap: 12, width: 320 }}>
      {(['default', 'elevated', 'outlined'] as const).map((variant) => (
        <Card key={variant} variant={variant}>
          {body}
        </Card>
      ))}
    </View>
  ),
  parameters: { controls: { disable: true } },
};

export const AccessibilityExample = {
  args: {
    children: body,
    accessible: true,
    accessibilityRole: 'summary',
    accessibilityLabel: 'Netflix subscription, fifteen dollars and forty-nine cents per month',
  },
  parameters: {
    docs: {
      description: {
        story: 'Set an explicit accessible label and role when the card represents one grouped item.',
      },
    },
  },
};
