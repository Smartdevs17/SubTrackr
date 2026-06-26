// Expo dynamic config. When app.config.js exists, Expo loads it and passes the
// static app.json contents as `config`; we extend it with screen-level
// compilation tiers and the startup performance budget. Both live under
// `extra` so they ship in the manifest and are readable at build time by
// metro.config.js and scripts/check-performance-budget.js.
//
// See docs/hermes-differential-bytecode.md for how to assign a screen to a tier.

/**
 * Screen compilation tiers.
 * - eager: critical-path screens compiled into the initial Hermes bytecode
 *          chunk and loaded at startup (lowest latency, larger initial bundle).
 * - lazy:  non-critical screens emitted as separate chunks and loaded on demand
 *          via React.lazy in src/navigation/AppNavigator.tsx.
 */
const SCREEN_TIERS = {
  eager: ['Home', 'SubscriptionDetail', 'Analytics', 'CryptoPayment'],
  lazy: [
    'CancellationFlow',
    'Community',
    'Profile',
    'SlaDashboard',
    'GDPRSettings',
    'LanguageSettings',
    'SessionManagement',
    'CalendarIntegration',
    'AccountingExport',
    'WebhookSettings',
    'ErrorDashboard',
    'AdminDashboard',
    'FraudDashboard',
    'InvoiceList',
    'InvoiceDetail',
    'UsageDashboard',
    'DeveloperPortal',
    'SandboxDashboard',
    'ApiKeyManagement',
    'DocumentationPortal',
    'IntegrationGuides',
    'SegmentManagement',
    'SegmentDetail',
    'Gamification',
  ],
};

/** Startup performance budget enforced by scripts/check-performance-budget.js. */
const PERFORMANCE_BUDGET = {
  // Hard ceiling for cold-start time to interactive (ms).
  startupBudgetMs: 2000,
  // Required improvement vs the recorded baseline (>= 30%).
  startupImprovementTarget: 0.3,
  // Required peak-memory reduction vs baseline (>= 20%).
  peakMemoryReductionTarget: 0.2,
  // Lazy chunk loads must not drop frames beyond one 60fps frame (~16.7ms).
  maxFrameMs: 16.7,
};

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra || {}),
    screenTiers: SCREEN_TIERS,
    performanceBudget: PERFORMANCE_BUDGET,
  },
});
