module.exports = function (api) {
  api.cache(true);
  const isProduction = process.env.NODE_ENV === 'production';

  const plugins = [
    [
      'babel-plugin-module-resolver',
      {
        root: ['./src'],
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
      },
    ],
  ];

  if (isProduction) {
    plugins.push(['babel-plugin-transform-remove-console', { exclude: ['error', 'warn'] }]);
  }

  return {
    // `babel-preset-expo` already lowers dynamic `import()` to the async
    // require form Metro needs for on-demand screen chunks (see AppNavigator
    // and metro.config.js inlineRequires). Lazy module *evaluation* is handled
    // by Metro's inlineRequires transform rather than a Babel plugin here, so
    // the preset configuration is intentionally minimal.
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    plugins,
  };
};
