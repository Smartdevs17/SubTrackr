import React from 'react';
import { Text } from 'react-native';
import { Card } from '../Card';

export default {
  title: 'Shared/Card',
  component: Card,
  argTypes: {
    variant: { control: 'select', options: ['default', 'elevated', 'outlined'] },
    padding: { control: 'select', options: ['none', 'small', 'medium', 'large'] },
  },
};

const body = <Text>Netflix, $15.49 / month</Text>;

export const Default = { args: { children: body } };
export const Elevated = { args: { children: body, variant: 'elevated' } };
export const Outlined = { args: { children: body, variant: 'outlined' } };
export const NoPadding = { args: { children: body, padding: 'none' } };
