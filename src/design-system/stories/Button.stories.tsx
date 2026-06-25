/**
 * Button Component Stories for Storybook
 * Comprehensive component documentation and visual testing
 *
 * Run: npm run storybook
 */

import type { Meta, StoryObj } from '@storybook/react-native';
import { View, Text } from 'react-native';
import { Button } from '../components/Button';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  argTypes: {
    label: {
      control: { type: 'text' },
      description: 'Button label text',
    },
    variant: {
      options: ['primary', 'secondary', 'outline', 'ghost', 'danger', 'success', 'crypto'],
      control: { type: 'select' },
      description: 'Button visual variant',
    },
    size: {
      options: ['small', 'medium', 'large'],
      control: { type: 'select' },
      description: 'Button size',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Disable button interactions',
    },
    loading: {
      control: { type: 'boolean' },
      description: 'Show loading indicator',
    },
    fullWidth: {
      control: { type: 'boolean' },
      description: 'Make button full width',
    },
  },
  parameters: {
    controls: { expanded: true },
    docs: {
      description: {
        component:
          'Accessible button component with multiple variants, sizes, and states. WCAG 2.1 AA compliant with 44x44pt minimum touch targets.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// ============================================================================
// BASIC STORIES
// ============================================================================

export const Primary: Story = {
  args: {
    label: 'Primary Button',
    variant: 'primary',
    size: 'medium',
    onPress: () => alert('Button pressed'),
  },
};

export const Secondary: Story = {
  args: {
    label: 'Secondary Button',
    variant: 'secondary',
    size: 'medium',
    onPress: () => alert('Button pressed'),
  },
};

export const Outline: Story = {
  args: {
    label: 'Outline Button',
    variant: 'outline',
    size: 'medium',
    onPress: () => alert('Button pressed'),
  },
};

export const Ghost: Story = {
  args: {
    label: 'Ghost Button',
    variant: 'ghost',
    size: 'medium',
    onPress: () => alert('Button pressed'),
  },
};

export const Danger: Story = {
  args: {
    label: 'Delete',
    variant: 'danger',
    size: 'medium',
    onPress: () => alert('Delete action'),
  },
};

export const Success: Story = {
  args: {
    label: 'Confirm',
    variant: 'success',
    size: 'medium',
    onPress: () => alert('Confirmed'),
  },
};

export const Crypto: Story = {
  args: {
    label: 'Connect Wallet',
    variant: 'crypto',
    size: 'medium',
    onPress: () => alert('Connecting wallet'),
  },
};

// ============================================================================
// SIZE STORIES
// ============================================================================

export const Small: Story = {
  args: {
    label: 'Small',
    variant: 'primary',
    size: 'small',
    onPress: () => {},
  },
};

export const Medium: Story = {
  args: {
    label: 'Medium',
    variant: 'primary',
    size: 'medium',
    onPress: () => {},
  },
};

export const Large: Story = {
  args: {
    label: 'Large',
    variant: 'primary',
    size: 'large',
    onPress: () => {},
  },
};

export const AllSizes: Story = {
  render: () => (
    <View style={{ gap: 16, padding: 16 }}>
      <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 8 }}>Small</Text>
      <Button
        label="Small Button"
        variant="primary"
        size="small"
        onPress={() => {}}
        accessibilityLabel="Small button"
      />

      <Text style={{ fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 8 }}>
        Medium
      </Text>
      <Button
        label="Medium Button"
        variant="primary"
        size="medium"
        onPress={() => {}}
        accessibilityLabel="Medium button"
      />

      <Text style={{ fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 8 }}>Large</Text>
      <Button
        label="Large Button"
        variant="primary"
        size="large"
        onPress={() => {}}
        accessibilityLabel="Large button"
      />
    </View>
  ),
};

// ============================================================================
// STATE STORIES
// ============================================================================

export const Disabled: Story = {
  args: {
    label: 'Disabled Button',
    variant: 'primary',
    size: 'medium',
    disabled: true,
    onPress: () => {},
    accessibilityLabel: 'Disabled button',
  },
};

export const Loading: Story = {
  args: {
    label: 'Loading...',
    variant: 'primary',
    size: 'medium',
    loading: true,
    onPress: () => {},
    accessibilityLabel: 'Loading button',
  },
};

export const AllVariants: Story = {
  render: () => (
    <View style={{ gap: 12, padding: 16 }}>
      <Button
        label="Primary"
        variant="primary"
        onPress={() => {}}
        accessibilityLabel="Primary variant"
      />
      <Button
        label="Secondary"
        variant="secondary"
        onPress={() => {}}
        accessibilityLabel="Secondary variant"
      />
      <Button
        label="Outline"
        variant="outline"
        onPress={() => {}}
        accessibilityLabel="Outline variant"
      />
      <Button label="Ghost" variant="ghost" onPress={() => {}} accessibilityLabel="Ghost variant" />
      <Button
        label="Danger"
        variant="danger"
        onPress={() => {}}
        accessibilityLabel="Danger variant"
      />
      <Button
        label="Success"
        variant="success"
        onPress={() => {}}
        accessibilityLabel="Success variant"
      />
      <Button
        label="Crypto"
        variant="crypto"
        onPress={() => {}}
        accessibilityLabel="Crypto variant"
      />
    </View>
  ),
};

// ============================================================================
// LAYOUT STORIES
// ============================================================================

export const FullWidth: Story = {
  args: {
    label: 'Full Width Button',
    variant: 'primary',
    size: 'medium',
    fullWidth: true,
    onPress: () => {},
    accessibilityLabel: 'Full width button',
  },
};

// ============================================================================
// ACCESSIBILITY STORIES
// ============================================================================

export const WithAccessibilityLabel: Story = {
  args: {
    label: 'Save Changes',
    variant: 'primary',
    size: 'medium',
    onPress: () => {},
    accessibilityLabel: 'Save all changes to your subscription preferences',
    accessibilityHint: 'Your changes will be saved immediately',
  },
};

export const AccessibilityDocumentation: Story = {
  render: () => (
    <View style={{ padding: 16, gap: 16 }}>
      <Text style={{ fontSize: 16, fontWeight: 'bold' }}>Accessibility Features</Text>
      <Text style={{ fontSize: 12 }}>
        • Minimum 44x44pt touch target (WCAG 2.1 AA) • Proper accessibility labels • Disabled state
        indication • Loading state feedback • Font scaling support
      </Text>

      <Text style={{ fontSize: 14, fontWeight: '600', marginTop: 12 }}>Examples:</Text>

      <View style={{ gap: 12 }}>
        <View>
          <Text style={{ fontSize: 12, marginBottom: 8 }}>With Label Only</Text>
          <Button
            label="Submit"
            variant="primary"
            onPress={() => {}}
            accessibilityLabel="Submit form"
          />
        </View>

        <View>
          <Text style={{ fontSize: 12, marginBottom: 8 }}>With Label and Hint</Text>
          <Button
            label="Delete"
            variant="danger"
            onPress={() => {}}
            accessibilityLabel="Delete subscription"
            accessibilityHint="This action cannot be undone"
          />
        </View>

        <View>
          <Text style={{ fontSize: 12, marginBottom: 8 }}>Disabled Button</Text>
          <Button
            label="Locked Feature"
            variant="primary"
            disabled
            onPress={() => {}}
            accessibilityLabel="Locked feature button"
            accessibilityHint="Upgrade to unlock this feature"
          />
        </View>
      </View>
    </View>
  ),
};
