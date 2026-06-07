#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const budgetPath = path.resolve(process.cwd(), 'performance-budget.json');
const reportPath =
  process.env.PERFORMANCE_REPORT ||
  path.resolve(process.cwd(), 'artifacts/performance-report.json');

const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

const assertPositive = (key) => {
  if (typeof budget[key] !== 'number' || budget[key] <= 0) {
    throw new Error(`Invalid performance budget: ${key} must be a positive number`);
  }
};

assertPositive('renderMs');
assertPositive('apiLatencyMs');
assertPositive('memoryBytes');

if (!fs.existsSync(reportPath)) {
  console.log(`No performance report found at ${reportPath}; validated budget configuration only.`);
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const failures = [];

if (report.renderP95Ms > budget.renderMs) {
  failures.push(`render p95 ${report.renderP95Ms}ms exceeds ${budget.renderMs}ms`);
}

if (report.apiLatencyP95Ms > budget.apiLatencyMs) {
  failures.push(`API latency p95 ${report.apiLatencyP95Ms}ms exceeds ${budget.apiLatencyMs}ms`);
}

if (report.memoryMaxBytes > budget.memoryBytes) {
  failures.push(`memory max ${report.memoryMaxBytes} bytes exceeds ${budget.memoryBytes} bytes`);
}

if (report.androidStartupMs && report.androidStartupMs > budget.androidStartupMs) {
  failures.push(
    `Android startup ${report.androidStartupMs}ms exceeds ${budget.androidStartupMs}ms`
  );
}

if (report.androidFps && report.androidFps < budget.androidFrameRateFps) {
  failures.push(
    `Android FPS ${report.androidFps}fps below target ${budget.androidFrameRateFps}fps`
  );
}

if (failures.length) {
  console.error(`Performance budget failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Performance budget passed.');
