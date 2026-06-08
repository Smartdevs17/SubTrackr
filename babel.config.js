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
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    plugins,
  };
};
