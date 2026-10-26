#!/usr/bin/env node

/**
 * Mutation Score Check & Summary Script
 *
 * Reads Stryker mutation test reports and:
 * - Fails the build if the mutation score is below the break threshold
 * - Prints a summary of weak tests (low mutation score areas)
 * - Optionally generates a dashboard-compatible JSON summary
 *
 * Report paths and thresholds are read from the Stryker configs rather than
 * hardcoded, so this script cannot drift away from the gate Stryker and CI
 * actually enforce.
 *
 * Usage:
 *   node scripts/check-mutation-score.js                  # check all reports
 *   node scripts/check-mutation-score.js --module=frontend # check frontend only
 *   node scripts/check-mutation-score.js --module=backend  # check backend only
 *   node scripts/check-mutation-score.js --allow-missing  # do not fail on absent reports
 */

const fs = require('fs');
const path = require('path');

const MODULES = [
  { name: 'frontend', config: 'stryker.conf.json' },
  { name: 'backend', config: 'stryker.backend.conf.json' },
];

const args = process.argv.slice(2);
const moduleFlag = args.find((a) => a.startsWith('--module='));
const moduleFilter = moduleFlag ? moduleFlag.split('=')[1] : null;
const allowMissing = args.includes('--allow-missing');

/**
 * Resolves a module's report path and thresholds from its Stryker config, so
 * the paths stay in step with what Stryker actually writes and the thresholds
 * stay in step with what Stryker actually enforces.
 */
function loadModuleConfig(name, configFile) {
  const fallback = { name, reportPath: null, breakThreshold: 80, lowThreshold: 80 };
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(process.cwd(), configFile), 'utf-8'));
  } catch (error) {
    console.warn(`  ! Could not read ${configFile}: ${error.message}`);
    return fallback;
  }
  const reportPath = config.jsonReporter && config.jsonReporter.fileName;
  const thresholds = config.thresholds || {};
  return {
    name,
    reportPath: typeof reportPath === 'string' ? reportPath : null,
    breakThreshold: typeof thresholds.break === 'number' ? thresholds.break : 80,
    lowThreshold: typeof thresholds.low === 'number' ? thresholds.low : 80,
  };
}

function readReport(reportPath) {
  if (!reportPath) return null;
  const fullPath = path.join(process.cwd(), reportPath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  } catch (error) {
    console.error(`  ! ${reportPath} is not valid JSON: ${error.message}`);
    return null;
  }
}

function extractScore(report) {
  if (!report) return null;
  const metrics = report.metrics || report;
  if (metrics.mutationScore !== undefined) {
    return {
      score: metrics.mutationScore,
      killed: metrics.killed,
      survived: metrics.survived,
      noCoverage: metrics.noCoverage,
      total: metrics.totalDetected + metrics.totalUndetected || metrics.totalMutants,
      timeout: metrics.timeout,
      runtimeError: metrics.runtimeErrors,
      compileError: metrics.compileErrors,
    };
  }
  return null;
}

function findWeakTests(report, moduleName, lowThreshold) {
  const weak = [];
  if (!report || !report.files) return weak;

  for (const [filePath, fileData] of Object.entries(report.files)) {
    const fileMetrics = fileData.metrics || fileData;
    const fileScore = fileMetrics.mutationScore;
    if (fileScore !== undefined && fileScore < lowThreshold) {
      weak.push({
        file: filePath,
        score: fileScore,
        killed: fileMetrics.killed,
        survived: fileMetrics.survived,
        module: moduleName,
      });
    }
  }
  return weak.sort((a, b) => a.score - b.score);
}

function printScore(name, data, breakThreshold) {
  if (!data) {
    console.log('\n  [' + name + '] No report found');
    return false;
  }
  const score = data.score.toFixed(2);
  const status = data.score >= breakThreshold ? 'PASS' : 'FAIL';
  const icon = data.score >= breakThreshold ? '\u2713' : '\u2717';

  console.log('\n  ' + icon + ' [' + name + '] Mutation Score: ' + score + '% (' + status + ')');
  console.log(
    '      Killed: ' +
      data.killed +
      ' | Survived: ' +
      data.survived +
      ' | No Coverage: ' +
      data.noCoverage
  );
  console.log('      Total Mutants: ' + data.total + ' | Timeouts: ' + data.timeout);

  if (data.compileError > 0) {
    console.log('      \u26A0 Compile Errors: ' + data.compileError);
  }
  if (data.runtimeError > 0) {
    console.log('      \u26A0 Runtime Errors: ' + data.runtimeError);
  }

  return data.score >= breakThreshold;
}

function printWeakTests(weakTests, lowThreshold) {
  if (weakTests.length === 0) {
    console.log(
      '\n  \u2713 No weak tests detected (all files above ' + lowThreshold + '% threshold)'
    );
    return;
  }

  console.log('\n  \u26A0 Weak Tests Detected (score < ' + lowThreshold + '%):');
  console.log('  ' + '-'.repeat(70));
  weakTests.forEach((w) => {
    console.log('    ' + w.file);
    console.log(
      '      Score: ' +
        w.score.toFixed(2) +
        '% | Killed: ' +
        w.killed +
        ' | Survived: ' +
        w.survived +
        ' | Module: ' +
        w.module
    );
  });
  console.log('\n  Total weak files: ' + weakTests.length);
}

function generateDashboardJson(frontendScore, backendScore, frontendWeak, backendWeak, thresholds) {
  const dashboard = {
    generatedAt: new Date().toISOString(),
    thresholds,
    modules: {},
    weakTests: [],
  };

  if (frontendScore) {
    dashboard.modules.frontend = {
      score: frontendScore.score,
      killed: frontendScore.killed,
      survived: frontendScore.survived,
      total: frontendScore.total,
      passed: frontendScore.score >= thresholds.break,
    };
  }

  if (backendScore) {
    dashboard.modules.backend = {
      score: backendScore.score,
      killed: backendScore.killed,
      survived: backendScore.survived,
      total: backendScore.total,
      passed: backendScore.score >= thresholds.break,
    };
  }

  dashboard.weakTests = [].concat(frontendWeak || []).concat(backendWeak || []);

  const dashboardDir = path.join(process.cwd(), 'reports', 'mutation-dashboard');
  if (!fs.existsSync(dashboardDir)) {
    fs.mkdirSync(dashboardDir, { recursive: true });
  }
  fs.writeFileSync(path.join(dashboardDir, 'dashboard.json'), JSON.stringify(dashboard, null, 2));
  console.log('\n  Dashboard JSON written to reports/mutation-dashboard/dashboard.json');
}

// --- Main ---
console.log('\n=== Mutation Score Check ===\n');

const configs = MODULES.map((m) => loadModuleConfig(m.name, m.config));
const frontendConfig = configs.find((c) => c.name === 'frontend');
const backendConfig = configs.find((c) => c.name === 'backend');

function checkModule(config) {
  const report = readReport(config.reportPath);
  const score = extractScore(report);
  const label = config.name === 'frontend' ? 'Frontend' : 'Backend';
  const passed = printScore(label, score, config.breakThreshold);
  let weak = [];
  if (report) {
    weak = findWeakTests(report, config.name, config.lowThreshold);
    printWeakTests(weak, config.lowThreshold);
  }
  return { score, weak, passed };
}

const frontendResult =
  !moduleFilter || moduleFilter === 'frontend' ? checkModule(frontendConfig) : null;
const backendResult =
  !moduleFilter || moduleFilter === 'backend' ? checkModule(backendConfig) : null;

// Generate dashboard JSON
generateDashboardJson(
  frontendResult ? frontendResult.score : null,
  backendResult ? backendResult.score : null,
  frontendResult ? frontendResult.weak : [],
  backendResult ? backendResult.weak : [],
  {
    high: Math.max(frontendConfig.breakThreshold, backendConfig.breakThreshold) + 10,
    low: Math.min(frontendConfig.lowThreshold, backendConfig.lowThreshold),
    break: Math.max(frontendConfig.breakThreshold, backendConfig.breakThreshold),
  }
);

// Determine exit code. A missing report is a failure: without this the script
// reported success even when no mutation run had ever happened.
const allPassed = [];
for (const [label, result] of [
  ['Frontend', frontendResult],
  ['Backend', backendResult],
]) {
  if (!result) continue;
  if (!result.score) {
    if (!allowMissing) {
      console.error(
        `  \u2717 ${label}: no mutation report at ` +
          `${(label === 'Frontend' ? frontendConfig : backendConfig).reportPath}. ` +
          'Run `npm run mutation:test' +
          (label === 'Backend' ? ':backend' : '') +
          '` first, or pass --allow-missing.'
      );
      allPassed.push(false);
    } else {
      allPassed.push(true);
    }
    continue;
  }
  allPassed.push(result.passed);
}

const exitCode = allPassed.every(Boolean) ? 0 : 1;
console.log(
  '\n' +
    (exitCode === 0
      ? '\u2713 All mutation score checks passed.'
      : '\u2717 Some mutation score checks failed.') +
    '\n'
);
process.exit(exitCode);
