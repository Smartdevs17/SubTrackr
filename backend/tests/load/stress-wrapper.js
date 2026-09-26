/**
 * Backend Load Test Wrapper
 * This script can be used to trigger k6 tests from a backend context or
 * to provide a wrapper for internal stress testing of specific modules.
 */

const { spawn } = require('child_process');

function runLoadTest(scenario = 'subscription') {
  console.log(`Starting load test for scenario: ${scenario}...`);

  const k6 = spawn('k6', ['run', '-e', `SCENARIO=${scenario}`, '../../load-tests/run.js']);

  k6.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });

  k6.stderr.on('data', (data) => {
    console.warn(`stderr: ${data}`);
  });

  k6.on('close', (code) => {
    console.log(`Load test finished with code ${code}`);
  });
}

// Example usage:
// runLoadTest('billing');

module.exports = { runLoadTest };
