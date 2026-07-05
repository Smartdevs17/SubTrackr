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

module.exports = config;
