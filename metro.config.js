const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ─── Tree-shaking / minification ─────────────────────────────────────────────
// Enable minification in production so unused code paths are removed by the
// Metro bundler's inline-requires and dead-code-elimination passes.
config.transformer = {
  ...config.transformer,
  // Inline requires defers module evaluation until first use — this effectively
  // implements lazy loading for heavy modules (ethers, stellar-sdk, etc.)
  // and removes them from the critical path entirely when not needed.
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

// ─── Resolver: platform-specific module aliases ───────────────────────────────
// Prefer the ES-module (tree-shakeable) entry point for libraries that ship
// both CJS and ESM builds.
config.resolver = {
  ...config.resolver,
  // Prioritise .mjs then .js so bundler picks up ESM where available
  sourceExts: ['mjs', 'js', 'jsx', 'ts', 'tsx', 'cjs', 'json'],
};

// ─── Bundle analyser ──────────────────────────────────────────────────────────
// To analyse bundle size locally, run:
//   npx react-native-bundle-visualizer
// (metro-bundle-analyzer was removed — it was never published to npm)

module.exports = config;
