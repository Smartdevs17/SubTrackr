const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer = {
  ...config.transformer,
  experimentalImportBundleSupport: true,
  hermesEnabled: true,
  unstable_transformImportMeta: true,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: true,
      inlineRequires: true,
    },
  }),
};

if (process.env.NODE_ENV === 'production') {
  config.transformer.minifierConfig = {
    compress: {
      drop_console: true,
      drop_debugger: true,
      pure_funcs: ['console.info', 'console.debug', 'console.trace'],
    },
  };
  try {
    const hermesSerializer = require('@shopify/metro-serializer-hermes');
    config.serializer.customSerializer = hermesSerializer.serializer;
  } catch (e) {
    // Serializer not available, continue without it
  }
}

config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];
config.resolver.unstable_enablePackageExports = true;

// Exclude non-bundle directories from Metro bundling
config.resolver.blockList = [
  /backend\/.*/,
  /app\/.*/,
  /developer-portal\/.*/,
  /contracts\/.*/,
  /chaos\/.*/,
  /sandbox\/.*/,
  /ml-service\/.*/,
  /src\/design-system\/.*/,
];

// ── CDN asset configuration ────────────────────────────────────────────────────
// Assets served from Expo CDN get long-lived immutable Cache-Control headers.
// The content hash in the asset filename ensures cache invalidation on change.
config.transformer.assetPlugins = config.transformer.assetPlugins || [];

// Ensure all static asset file types are covered
config.resolver.assetExts = [
  ...(config.resolver.assetExts || []),
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'mp4',
  'mov',
  'mp3',
  'wav',
  'lottie',
  'json',
];

// Asset hash in filename for cache-busting (Metro default behaviour; explicit here for clarity)
config.transformer.assetRegistryPath = 'react-native/Libraries/Image/AssetRegistry';

module.exports = config;
