module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { unstable_transformProfile: 'default' }]],
    plugins: ['@babel/plugin-transform-flow-strip-types'],
    overrides: [
      {
        plugins: ['babel-plugin-syntax-hermes-parser'],
        test: (filename) => {
          return (
            !filename ||
            (!filename.includes('node_modules/react-native/Libraries/NativeComponent') &&
              !filename.endsWith('.ts') &&
              !filename.endsWith('.tsx'))
          );
        },
      },
    ],
  };
};
