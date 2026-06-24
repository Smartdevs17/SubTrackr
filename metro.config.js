const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.experimentalImportBundleSupport = true;
config.transformer.inlineRequires = true;

config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];

module.exports = config;
