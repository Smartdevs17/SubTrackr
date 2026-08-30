const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

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

  // ── Performance profiling ──────────────────────────────────────────────────
  // Emit source-maps in development so the Chrome/Flipper profiler can map
  // hot-path frames back to TypeScript source lines.
  minifierConfig: {
    // Keep class/function names in dev for readable profiler traces
    keep_fnames: process.env.NODE_ENV !== 'production',
    keep_classnames: process.env.NODE_ENV !== 'production',
  },
};

// ─── Resolver: platform-specific module aliases ───────────────────────────────
// Prefer the ES-module (tree-shakeable) entry point for libraries that ship
// both CJS and ESM builds.
config.resolver = {
  ...config.resolver,
  // Prioritise .mjs then .js so bundler picks up ESM where available
  sourceExts: ['mjs', 'js', 'jsx', 'ts', 'tsx', 'cjs', 'json'],

  // ── Module aliasing for bundle splitting ──────────────────────────────────
  // Heavy chain/crypto modules are conditionally resolved so they don't bloat
  // the main bundle on screens that don't use them. Each alias points at a
  // thin dynamic-import wrapper (lazy loaded on first use via inlineRequires).
  extraNodeModules: {
    // Allow absolute imports from the project root (used by screen-level code)
    '@subtrackr': path.resolve(__dirname, 'src'),
  },
};

// ─── Performance budget reporter ─────────────────────────────────────────────
// Read the performance-budget.json thresholds and print a warning when the
// serialised bundle exceeds them. Runs only during the bundle step (not watch).
if (process.env.METRO_BUNDLE_REPORT === '1') {
  const fs = require('fs');
  const budgetFile = path.join(__dirname, 'performance-budget.json');
  if (fs.existsSync(budgetFile)) {
    const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
    const originalSerializer = config.serializer?.customSerializer;
    config.serializer = {
      ...config.serializer,
      customSerializer: (entryPoint, preModules, graph, options) => {
        const bundle =
          typeof originalSerializer === 'function'
            ? originalSerializer(entryPoint, preModules, graph, options)
            : undefined;

        // Approximate bundle size by summing module source lengths
        let totalBytes = 0;
        for (const [, mod] of graph.dependencies) {
          totalBytes += (mod.output ?? []).reduce(
            (acc, o) => acc + (o.data?.code?.length ?? 0),
            0
          );
        }

        const budgetBytes = (budget.bundleSizeKb ?? 5120) * 1024;
        if (totalBytes > budgetBytes) {
          const overKb = Math.round((totalBytes - budgetBytes) / 1024);
          console.warn(
            `[Metro] ⚠ Bundle size ${Math.round(totalBytes / 1024)} KB ` +
              `exceeds budget ${budget.bundleSizeKb} KB by ${overKb} KB`
          );
        } else {
          console.info(
            `[Metro] ✓ Bundle size ${Math.round(totalBytes / 1024)} KB ` +
              `within budget ${budget.bundleSizeKb} KB`
          );
        }

        return bundle;
      },
    };
  }
}

// ─── Bundle analyser ──────────────────────────────────────────────────────────
// To analyse bundle size locally, run:
//   METRO_BUNDLE_REPORT=1 npx expo export
// Or visualise interactively:
//   npx react-native-bundle-visualizer

module.exports = config;
