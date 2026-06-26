const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ── Differential Hermes bytecode / lazy chunk loading ─────────────────────────
// `inlineRequires` defers each module's evaluation until it is first used rather
// than eagerly at bundle load. Combined with the dynamic `import()` calls in
// src/navigation/AppNavigator.tsx, Metro splits non-critical screens into
// separately-loadable segments and Hermes compiles them to bytecode lazily —
// shrinking the startup parse/compile window and peak memory.
//
// Hermes bytecode generation itself (the `-emit-binary` / `hermesc` step) is
// driven by Expo's release build pipeline; this config controls *what* lands in
// the initial chunk vs. on-demand chunks. If a chunk is unavailable at runtime,
// the dynamic import rejects and AppNavigator's error boundary falls back to a
// retry that re-fetches from the full bundle.
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

module.exports = config;
