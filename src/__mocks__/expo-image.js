/**
 * Lightweight Jest mock for expo-image.
 *
 * Renders a plain View and stubs the static caching methods used by
 * src/utils/imageCache.ts and src/components/subscription/SubscriptionIcon.tsx.
 */

const React = require('react');
const { View } = require('react-native');

const Image = (props) => React.createElement(View, props);

Image.prefetch = jest.fn(() => Promise.resolve(true));
Image.clearDiskCache = jest.fn(() => Promise.resolve());
Image.clearMemoryCache = jest.fn(() => Promise.resolve());

module.exports = {
  __esModule: true,
  Image,
  default: Image,
};
