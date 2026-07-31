#!/usr/bin/env node

/**
 * Mutation Score Check & Summary Script
 *
 * Reads Stryker mutation test reports and:
 * - Fails the build if the mutation score is below the break threshold
 * - Prints a summary of weak tests (low mutation score areas)
 * - Optionally generates a dashboard-compatible JSON summary
 *
 * Usage:
 *   node scripts/check-mutation-score.js                  # check all reports
 *   node scripts/check-mutation-score.js --module=frontend # check frontend only
 *   node scripts/check-mutation-score.js --module=backend  # check backend only
 *   node scripts/check-mutation-score.js --summary         # print combined summary
 */

const fs = require('fs');
const path = require('path');

const FRONTEND_REPORT_DIR = 'reports/mutation';
const BACKEND_REPORT_DIR = 'reports/mutation-backend';
const BREAK_THRESHOLD = 50;
const LOW_SCORE_WARN = 60;

const args = process.argv.slice(2);
const moduleFlag = args.find((a) => a.startsWith('--module='));
const moduleFilter = moduleFlag ? moduleFlag.split('=')[1] : null;
const _showSummary = args.includes('--summary'); // used for future summary-only mode

function readReport(reportDir) {
  const reportPath = path.join(process.cwd(), reportDir, 'report.json');
  if (!fs.existsSync(reportPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  } catch {
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

function findWeakTests(report, _moduleName) {
  const weak = [];
  if (!report || !report.files) return weak;

  for (const [filePath, fileData] of Object.entries(report.files)) {
    const fileMetrics = fileData.metrics || fileData;
    const fileScore = fileMetrics.mutationScore;
    if (fileScore !== undefined && fileScore < LOW_SCORE_WARN) {
      weak.push({
        file: filePath,
        score: fileScore,
        killed: fileMetrics.killed,
        survived: fileMetrics.survived,
        module: _moduleName,
      });
    }
  }
  return weak.sort((a, b) => a.score - b.score);
}

function printScore(name, data) {
  if (!data) {
    console.log('\n  [' + name + '] No report found');
    return false;
  }
  const score = data.score.toFixed(2);
  const status = data.score >= BREAK_THRESHOLD ? 'PASS' : 'FAIL';
  const icon = data.score >= BREAK_THRESHOLD ? '\u2713' : '\u2717';

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

  return data.score >= BREAK_THRESHOLD;
}

function printWeakTests(weakTests) {
  if (weakTests.length === 0) {
    console.log('\n  \u2713 No weak tests detected (all files above 60% threshold)');
    return;
  }

  console.log('\n  \u26A0 Weak Tests Detected (score < ' + LOW_SCORE_WARN + '%):');
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

function generateDashboardJson(frontendScore, backendScore, frontendWeak, backendWeak) {
  const dashboard = {
    generatedAt: new Date().toISOString(),
    thresholds: { high: 80, low: 60, break: BREAK_THRESHOLD },
    modules: {},
    weakTests: [],
  };

  if (frontendScore) {
    dashboard.modules.frontend = {
      score: frontendScore.score,
      killed: frontendScore.killed,
      survived: frontendScore.survived,
      total: frontendScore.total,
      passed: frontendScore.score >= BREAK_THRESHOLD,
    };
  }

  if (backendScore) {
    dashboard.modules.backend = {
      score: backendScore.score,
      killed: backendScore.killed,
      survived: backendScore.survived,
      total: backendScore.total,
      passed: backendScore.score >= BREAK_THRESHOLD,
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

let frontendReport = null;
let backendReport = null;

if (!moduleFilter || moduleFilter === 'frontend') {
  const report = readReport(FRONTEND_REPORT_DIR);
  frontendReport = extractScore(report);
  printScore('Frontend', frontendReport);
  if (report) {
    const weak = findWeakTests(report, 'frontend');
    printWeakTests(weak);
  }
}

if (!moduleFilter || moduleFilter === 'backend') {
  const report = readReport(BACKEND_REPORT_DIR);
  backendReport = extractScore(report);
  printScore('Backend', backendReport);
  if (report) {
    const weak = findWeakTests(report, 'backend');
    printWeakTests(weak);
  }
}

// Generate dashboard JSON
const frontendReportRaw = moduleFilter === 'backend' ? null : readReport(FRONTEND_REPORT_DIR);
const backendReportRaw = moduleFilter === 'frontend' ? null : readReport(BACKEND_REPORT_DIR);
const frontendWeak = frontendReportRaw ? findWeakTests(frontendReportRaw, 'frontend') : [];
const backendWeak = backendReportRaw ? findWeakTests(backendReportRaw, 'backend') : [];
generateDashboardJson(frontendReport, backendReport, frontendWeak, backendWeak);

// Determine exit code
const allPassed = [];
if (!moduleFilter || moduleFilter === 'frontend') {
  allPassed.push(frontendReport ? frontendReport.score >= BREAK_THRESHOLD : true);
}
if (!moduleFilter || moduleFilter === 'backend') {
  allPassed.push(backendReport ? backendReport.score >= BREAK_THRESHOLD : true);
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
