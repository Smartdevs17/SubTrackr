#!/usr/bin/env node
/**
 * scripts/check-performance-budget.js
 *
 * Validates frontend performance metrics against the thresholds in
 * performance-budget.json.  Used by `npm run performance:ci` and the
 * performance-ci GitHub Actions workflow.
 *
 * Exits 0 when all budgets pass, 1 when any budget is exceeded.
 *
 * When no report file is present the script validates the budget
 * configuration itself and exits 0 (useful in CI before an E2E run
 * has produced a report).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const budgetPath = path.resolve(process.cwd(), 'performance-budget.json');
const reportPath =
  process.env.PERFORMANCE_REPORT ||
  path.resolve(process.cwd(), 'artifacts/performance-report.json');

// ── Load & validate budget config ────────────────────────────────────────────

const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

const assertPositive = (key) => {
  if (typeof budget[key] !== 'number' || budget[key] <= 0) {
    throw new Error(`Invalid performance budget: ${key} must be a positive number`);
  }
};

['renderMs', 'apiLatencyMs', 'memoryBytes'].forEach(assertPositive);

// Optional fields — validated when present
const optionalPositive = [
  'routeTransitionMs',
  'lcpMs',
  'fidMs',
  'clsFrameDrops',
  'bundleSizeBytes',
  'androidStartupMs',
  'androidFrameRateFps',
];

for (const key of optionalPositive) {
  if (budget[key] !== undefined) {
    assertPositive(key);
  }
}

// ── Check report if available ─────────────────────────────────────────────────

if (!fs.existsSync(reportPath)) {
  console.log(`No performance report found at ${reportPath}; validated budget configuration only.`);
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const failures = [];

// Core render / API / memory
if (report.renderP95Ms > budget.renderMs) {
  failures.push(`render p95 ${report.renderP95Ms}ms exceeds ${budget.renderMs}ms`);
}
if (report.apiLatencyP95Ms > budget.apiLatencyMs) {
  failures.push(`API latency p95 ${report.apiLatencyP95Ms}ms exceeds ${budget.apiLatencyMs}ms`);
}
if (report.memoryMaxBytes > budget.memoryBytes) {
  failures.push(`memory max ${report.memoryMaxBytes} bytes exceeds ${budget.memoryBytes} bytes`);
}

// Android startup / frame rate
if (budget.androidStartupMs && report.androidStartupMs > budget.androidStartupMs) {
  failures.push(
    `Android startup ${report.androidStartupMs}ms exceeds ${budget.androidStartupMs}ms`
  );
}
if (budget.androidFrameRateFps && report.androidFps < budget.androidFrameRateFps) {
  failures.push(
    `Android FPS ${report.androidFps}fps below target ${budget.androidFrameRateFps}fps`
  );
}

// Core Web Vitals
if (budget.lcpMs && report.lcpMs != null && report.lcpMs > budget.lcpMs) {
  failures.push(`LCP ${report.lcpMs}ms exceeds ${budget.lcpMs}ms`);
}
if (budget.fidMs && report.fidMs != null && report.fidMs > budget.fidMs) {
  failures.push(`FID ${report.fidMs}ms exceeds ${budget.fidMs}ms`);
}
if (
  budget.clsFrameDrops &&
  report.clsFrameDrops != null &&
  report.clsFrameDrops > budget.clsFrameDrops
) {
  failures.push(`CLS frame drops ${report.clsFrameDrops} exceeds ${budget.clsFrameDrops}`);
}

// Route transitions
if (budget.routeTransitionMs && report.routeTransitionP95Ms > budget.routeTransitionMs) {
  failures.push(
    `Route transition p95 ${report.routeTransitionP95Ms}ms exceeds ${budget.routeTransitionMs}ms`
  );
}

// Bundle size
if (budget.bundleSizeBytes && report.bundleSizeBytes > budget.bundleSizeBytes) {
  failures.push(
    `Bundle size ${(report.bundleSizeBytes / 1024 / 1024).toFixed(1)}MB exceeds ` +
      `${(budget.bundleSizeBytes / 1024 / 1024).toFixed(1)}MB`
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error(`Performance budget failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Performance budget passed.');
