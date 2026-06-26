module.exports = function (api) {
  api.cache(true);
  return {
    // `babel-preset-expo` already lowers dynamic `import()` to the async
    // require form Metro needs for on-demand screen chunks (see AppNavigator
    // and metro.config.js inlineRequires). Lazy module *evaluation* is handled
    // by Metro's inlineRequires transform rather than a Babel plugin here, so
    // the preset configuration is intentionally minimal.
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
  };
};
