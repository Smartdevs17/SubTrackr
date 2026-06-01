const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.hermesEnabled = true;
config.transformer.unstable_transformImportMeta = true;

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

config.resolver.unstable_enablePackageExports = true;

module.exports = config;