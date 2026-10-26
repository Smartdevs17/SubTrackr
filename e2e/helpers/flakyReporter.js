/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

/**
 * Jest reporter that surfaces flaky E2E tests.
 *
 * A test is "flaky" when it required more than one invocation to pass — i.e. it
 * failed at least once and only succeeded on a `jest.retryTimes` retry. These
 * are exactly the tests that erode confidence: green overall, but non-determ.
 *
 * The reporter writes a machine-readable report to `artifacts/flaky-report.json`
 * (uploaded as a CI artifact) and prints a summary. With `E2E_FAIL_ON_FLAKY=true`
 * the process exits non-zero when any flake is detected, enforcing the
 * "zero flaky failures" acceptance criterion in CI.
 */
class FlakyReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options || {};
    this._flaky = [];
  }

  onTestResult(_test, testResult) {
    for (const result of testResult.testResults) {
      // `invocations` counts every attempt; >1 with a pass means it flaked.
      const invocations = result.invocations || 1;
      if (invocations > 1 && result.status === 'passed') {
        this._flaky.push({
          title: result.fullName || result.title,
          file: testResult.testFilePath,
          attempts: invocations,
        });
      }
    }
  }

  onRunComplete(_contexts, results) {
    const outDir = this._options.outputDir || path.resolve(process.cwd(), 'artifacts');
    fs.mkdirSync(outDir, { recursive: true });
    const reportPath = path.join(outDir, 'flaky-report.json');

    const report = {
      generatedAt: new Date().toISOString(),
      totalTests: results.numTotalTests,
      failedTests: results.numFailedTests,
      flakyCount: this._flaky.length,
      flaky: this._flaky,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    if (this._flaky.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`\n⚠️  ${this._flaky.length} flaky test(s) detected (passed only after retry):`);
      for (const f of this._flaky) {
        // eslint-disable-next-line no-console
        console.warn(`   • ${f.title} (${f.attempts} attempts)`);
      }
      // eslint-disable-next-line no-console
      console.warn(`   Report: ${reportPath}\n`);

      if (process.env.E2E_FAIL_ON_FLAKY === 'true') {
        process.exitCode = 1;
      }
    }
  }
}

module.exports = FlakyReporter;
