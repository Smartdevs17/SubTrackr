/**
 * Storybook Configuration for SubTrackr Design System
 *
 * Location: .storybook/main.js
 * Run: npm run storybook
 */

module.exports = {
  stories: ['../src/design-system/stories/**/*.stories.{ts,tsx}', '../src/**/*.stories.{ts,tsx}'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-ondevice-actions',
    '@storybook/addon-ondevice-backgrounds',
    '@storybook/addon-ondevice-controls',
  ],
  framework: {
    name: '@storybook/react-native',
    options: {},
  },
  docs: {
    autodocs: 'tag',
    defaultName: 'Documentation',
  },
  typescript: {
    check: true,
    checkOptions: {},
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesAsTypes: true,
      shouldRemoveUndefinedFromOptional: true,
      propFilter: (prop) => {
        if (prop.parent) {
          return !prop.parent.fileName.includes('node_modules');
        }
        return true;
      },
    },
  },
};
