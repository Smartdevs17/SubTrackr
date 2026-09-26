/**
 * Minimal Babel configuration for backend (Node.js only) tests.
 *
 * Uses babel-preset-current-node-syntax (bundled with jest) + TypeScript
 * syntax plugin — no React Native, no Flow, no Expo.
 *
 * When node_modules are installed the standard @babel/preset-env +
 * @babel/preset-typescript combo takes over via babel-preset-expo.
 */
module.exports = {
  presets: ['babel-preset-current-node-syntax'],
  plugins: ['@babel/plugin-syntax-typescript'],
  overrides: [
    {
      test: /\.tsx?$/,
      plugins: [['@babel/plugin-syntax-typescript', { allExtensions: true }]],
    },
  ],
};
