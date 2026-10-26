jest.setTimeout(180000);

/**
 * Flaky-test mitigation: automatically re-run a failed E2E test before declaring
 * a failure. A test that only passes on retry is recorded as "flaky" by
 * `flakyReporter.js` so flakiness is surfaced and tracked rather than silently
 * masked. Retry count is configurable via E2E_RETRIES (default 2).
 *
 * Note: retries are a safety net, not a substitute for determinism — the helpers
 * in this suite (hermetic seeding, explicit waits, mocked network) are what keep
 * the retry count at zero in practice.
 */
const retries = process.env.E2E_RETRIES ? Number(process.env.E2E_RETRIES) : 2;

if (typeof jest.retryTimes === 'function') {
  jest.retryTimes(retries, { logErrorsBeforeRetry: true });
}
