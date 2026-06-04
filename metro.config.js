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
// Run:  EXPO_BUNDLE_ANALYZE=true npx expo export
// Then: npx react-native-bundle-visualizer
// Or:   npx metro-viz  (if installed)
//
// We wire this through an env flag so CI stays fast.
if (process.env.EXPO_BUNDLE_ANALYZE === 'true') {
  // metro-bundle-analyzer serialises a stats JSON alongside the bundle
  const { MetroBundleAnalyzerPlugin } = (() => {
    try {
      return require('metro-bundle-analyzer');
    } catch {
      console.warn(
        '[metro] metro-bundle-analyzer not installed. ' +
        'Run: npm install --save-dev metro-bundle-analyzer'
      );
      return { MetroBundleAnalyzerPlugin: null };
    }
  })();

  if (MetroBundleAnalyzerPlugin) {
    config.serializer = {
      ...config.serializer,
      customSerializer: MetroBundleAnalyzerPlugin.createSerializer({
        enabled: true,
        openAnalyzer: false,           // don't auto-open browser in CI
        fileName: 'bundle-stats.json', // output alongside dist/
      }),
    };
  }
}

module.exports = config;
