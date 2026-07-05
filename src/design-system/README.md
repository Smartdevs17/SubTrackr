/**
 * Design System - Storybook Configuration
 * Setup for component documentation and visual testing
 * 
 * Install Storybook:
 * npx sb@latest init --type react-native
 * 
 * Or manually add to your React Native project:
 * npm install @storybook/react-native @storybook/addon-essentials
 */

// Storybook configuration would be placed in .storybook/main.js
// This file serves as a reference for the component story structure

/**
 * Example Button Story for Storybook:
 * 
 * import type { Meta, StoryObj } from '@storybook/react-native';
 * import { Button } from '../src/design-system/components/Button';
 *
 * const meta: Meta<typeof Button> = {
 *   title: 'Components/Button',
 *   component: Button,
 *   argTypes: {
 *     variant: {
 *       options: ['primary', 'secondary', 'outline', 'ghost', 'danger', 'success', 'crypto'],
 *       control: { type: 'select' },
 *     },
 *     size: {
 *       options: ['small', 'medium', 'large'],
 *       control: { type: 'select' },
 *     },
 *     disabled: {
 *       control: { type: 'boolean' },
 *     },
 *     loading: {
 *       control: { type: 'boolean' },
 *     },
 *   },
 *   parameters: {
 *     controls: { expanded: true },
 *   },
 * };
 *
 * export default meta;
 * type Story = StoryObj<typeof meta>;
 *
 * export const Primary: Story = {
 *   args: {
 *     label: 'Primary Button',
 *     variant: 'primary',
 *     size: 'medium',
 *     onPress: () => alert('Button pressed'),
 *   },
 * };
 *
 * export const AllVariants: Story = {
 *   render: () => (
 *     <View style={{ gap: 16 }}>
 *       <Button label="Primary" variant="primary" onPress={() => {}} />
 *       <Button label="Secondary" variant="secondary" onPress={() => {}} />
 *       <Button label="Outline" variant="outline" onPress={() => {}} />
 *       <Button label="Ghost" variant="ghost" onPress={() => {}} />
 *       <Button label="Danger" variant="danger" onPress={() => {}} />
 *       <Button label="Success" variant="success" onPress={() => {}} />
 *     </View>
 *   ),
 * };
 */

// Storybook stories will be auto-discovered from:
// - src/**/*.stories.ts
// - src/**/*.stories.tsx

export const StorybookSetup = {
  description:
    'Storybook integration for SubTrackr Design System component documentation',
  setupSteps: [
    'Run: npx sb@latest init --type react-native',
    'Or manually: npm install @storybook/react-native @storybook/addon-essentials',
    'Create story files using *.stories.tsx pattern',
    'Run: npm run storybook',
    'Open http://localhost:6006 in browser',
  ],
  supportedAddons: [
    '@storybook/addon-essentials',
    '@storybook/addon-ondevice-actions',
    '@storybook/addon-ondevice-backgrounds',
    '@storybook/addon-ondevice-controls',
  ],
} as const;
