#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires, no-console */
/**
 * Startup performance budget enforcement.
 *
 * Reads the budget and screen-compilation tiers from app.config.js, validates
 * tier integrity, and — when a metrics file is present — checks measured cold
 * start against the budget and the recorded baseline:
 *
 *   - startup time within the hard ceiling (default 2000ms)
 *   - startup improvement vs baseline >= target (default 30%)
 *   - peak-memory reduction vs baseline >= target (default 20%)
 *   - no lazy-chunk frame drop beyond ~16.7ms
 *
 * Usage:
 *   node scripts/check-performance-budget.js [--metrics path] [--baseline path] [--strict]
 *
 * Exit codes: 0 = within budget (or no metrics and not --strict), 1 = violation.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const parseArgs = (argv) => {
  const args = { strict: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') args.strict = true;
    else if (arg === '--metrics') args.metrics = argv[(i += 1)];
    else if (arg === '--baseline') args.baseline = argv[(i += 1)];
  }
  return args;
};

const resolveAppConfig = () => {
  const appJson = require(path.join(ROOT, 'app.json'));
  const appConfig = require(path.join(ROOT, 'app.config.js'));
  const resolved =
    typeof appConfig === 'function' ? appConfig({ config: appJson.expo }) : appConfig;
  return resolved.extra || {};
};

const readJsonIfExists = (file) => {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const pct = (value) => `${(value * 100).toFixed(1)}%`;

const main = () => {
  const args = parseArgs(process.argv);
  const extra = resolveAppConfig();
  const budget = extra.performanceBudget;
  const tiers = extra.screenTiers;

  if (!budget || !tiers) {
    console.error('✗ Missing performanceBudget / screenTiers in app.config.js extra.');
    process.exit(1);
  }

  const failures = [];

  // 1. Tier integrity — no screen in both tiers, criticals present in eager.
  const overlap = tiers.eager.filter((s) => tiers.lazy.includes(s));
  if (overlap.length) failures.push(`Screens in both eager and lazy tiers: ${overlap.join(', ')}`);
  for (const critical of ['Home', 'SubscriptionDetail', 'Analytics', 'CryptoPayment']) {
    if (!tiers.eager.includes(critical)) {
      failures.push(`Critical screen "${critical}" must be in the eager tier.`);
    }
  }
  console.log(`Screen tiers: ${tiers.eager.length} eager, ${tiers.lazy.length} lazy.`);

  // 2. Measured metrics vs budget + baseline.
  const metricsPath = args.metrics || path.join(ROOT, 'perf', 'metrics.json');
  const baselinePath = args.baseline || path.join(ROOT, 'perf', 'baseline.json');
  const metrics = readJsonIfExists(metricsPath);
  const baseline = readJsonIfExists(baselinePath);

  if (!metrics) {
    const msg = `No metrics file at ${metricsPath} — skipping runtime budget checks.`;
    if (args.strict) {
      console.error(`✗ ${msg} (--strict)`);
      process.exit(1);
    }
    console.warn(`⚠ ${msg}`);
  } else {
    console.log(`\nStartup: ${metrics.startupMs}ms (budget ${budget.startupBudgetMs}ms)`);
    if (metrics.startupMs > budget.startupBudgetMs) {
      failures.push(`Startup ${metrics.startupMs}ms exceeds budget ${budget.startupBudgetMs}ms.`);
    }

    if (typeof metrics.maxFrameMs === 'number' && metrics.maxFrameMs > budget.maxFrameMs) {
      failures.push(
        `Lazy chunk load dropped frames: ${metrics.maxFrameMs}ms > ${budget.maxFrameMs}ms.`
      );
    }

    if (baseline) {
      const startupImprovement = (baseline.startupMs - metrics.startupMs) / baseline.startupMs;
      console.log(
        `Startup improvement vs baseline: ${pct(startupImprovement)} ` +
          `(target ${pct(budget.startupImprovementTarget)})`
      );
      if (startupImprovement < budget.startupImprovementTarget) {
        failures.push(
          `Startup improvement ${pct(startupImprovement)} below target ${pct(
            budget.startupImprovementTarget
          )}.`
        );
      }

      if (typeof metrics.peakMemoryMb === 'number' && typeof baseline.peakMemoryMb === 'number') {
        const memReduction = (baseline.peakMemoryMb - metrics.peakMemoryMb) / baseline.peakMemoryMb;
        console.log(
          `Peak memory reduction vs baseline: ${pct(memReduction)} ` +
            `(target ${pct(budget.peakMemoryReductionTarget)})`
        );
        if (memReduction < budget.peakMemoryReductionTarget) {
          failures.push(
            `Peak memory reduction ${pct(memReduction)} below target ${pct(
              budget.peakMemoryReductionTarget
            )}.`
          );
        }
      }
    } else {
      console.warn(`⚠ No baseline at ${baselinePath} — improvement targets not checked.`);
    }
  }

  if (failures.length) {
    console.error('\n✗ Performance budget violations:');
    for (const f of failures) console.error(`   • ${f}`);
    process.exit(1);
  }
  console.log('\n✓ Performance budget satisfied.');
};

main();
