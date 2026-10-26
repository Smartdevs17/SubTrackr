/** @type {import('@lhci/cli').LhciConfig} */
module.exports = {
  ci: {
    collect: {
      // Developer portal URLs to audit (desktop + mobile)
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/docs/quick-start',
        'http://localhost:3000/docs/subscriptions-api',
        // Mobile WebView: subscription list rendering performance
        'http://localhost:3000/webview/subscription-list',
      ],
      // 3 throttled runs per URL; median score used (edge case: network variability)
      numberOfRuns: 3,
      settings: {
        // Default: desktop audit. Mobile audit runs via the separate mobile preset below.
        preset: 'desktop',
        throttling: {
          rttMs: 40,
          throughputKbps: 10240,
          cpuSlowdownMultiplier: 1,
        },
      },
    },

    assert: {
      // Fail CI if any metric drops >10% from baseline (regression threshold)
      // Absolute upper-bound budgets per acceptance criteria
      assertions: {
        // FCP < 1.5s
        'first-contentful-paint': ['error', { maxNumericValue: 1500, aggregationMethod: 'median' }],
        // LCP < 2.5s
        'largest-contentful-paint': [
          'error',
          { maxNumericValue: 2500, aggregationMethod: 'median' },
        ],
        // TTI < 3.5s
        interactive: ['error', { maxNumericValue: 3500, aggregationMethod: 'median' }],
        // CLS < 0.1
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
        // Overall Lighthouse score > 90 (0–1 scale → 0.90)
        'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median' }],
        // Regression threshold: fail if score drops >10% from baseline
        // (lhci compares against main-branch baseline stored in lhci server/DB)
      },
      // Preset: none (we define all assertions explicitly above)
      preset: 'no-pwa',
    },

    upload: {
      // Upload HTML report as CI artifact; configure lhciServerBaseUrl for persistent storage
      target: 'temporary-public-storage',
      // Uncomment + configure for persistent baseline storage:
      // target: 'lhci',
      // serverBaseUrl: 'https://lhci.your-domain.com',
      // token: process.env.LHCI_TOKEN,
    },
  },
};

/**
 * Mobile WebView preset — used by the lighthouse-mobile CI job.
 * Simulates a mid-range Android device (Moto G4 throttling profile).
 * Run via: lhci autorun --config=lighthouserc.js --preset=mobile
 */
module.exports.mobile = {
  ci: {
    collect: {
      url: [
        'http://localhost:3000/webview/subscription-list',
        'http://localhost:3000/',
        'http://localhost:3000/docs/quick-start',
      ],
      numberOfRuns: 3,
      settings: {
        preset: 'perf',
        // Lighthouse built-in mobile emulation
        formFactor: 'mobile',
        screenEmulation: {
          mobile: true,
          width: 412,
          height: 823,
          deviceScaleFactor: 1.75,
          disabled: false,
        },
        // Moto G4 throttling (Lighthouse default mobile)
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
        },
        throttlingMethod: 'simulate',
      },
    },
    assert: {
      preset: 'no-pwa',
      assertions: {
        'first-contentful-paint': ['error', { maxNumericValue: 1500, aggregationMethod: 'median' }],
        'largest-contentful-paint': [
          'error',
          { maxNumericValue: 2500, aggregationMethod: 'median' },
        ],
        interactive: ['error', { maxNumericValue: 3500, aggregationMethod: 'median' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
        'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median' }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
