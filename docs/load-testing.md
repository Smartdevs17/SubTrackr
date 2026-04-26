# Load Testing with k6

SubTrackr uses **k6** for performance and load testing. This suite ensures our subscription system and contract interactions can handle high traffic and scale effectively.

## Prerequisites

- **macOS**: `brew install k6`
- **Windows**: `choco install k6`
- **Linux**: Follow [k6 installation guide](https://k6.io/docs/getting-started/installation/)

## Folder Structure

```text
load-tests/
  ├── scenarios/    # High-level test scenarios
  ├── config/       # Load profiles (VRs, stages, thresholds)
  ├── utils/        # Shared helpers and data generators
  ├── api/          # Atomic API endpoint tests
  ├── contracts/    # Contract interaction simulations
  └── run.js        # Main entry point
```

## Running Tests

### Standard Run

Run the default scenario (Subscription Flow):

```bash
npm run load:test
```

### Run Specific Scenario

Use environment variables to select a scenario:

```bash
# Windows
$env:SCENARIO="billing"; npm run load:test

# macOS/Linux
SCENARIO=billing npm run load:test
```

Available scenarios:

- `subscription`: Full End-to-End subscription lifecycle.
- `billing`: Stress test for monthly recurring billing spikes.
- `user`: Typical sustained user activity (fetching subscriptions).

### Pass Custom Parameters

```bash
k6 run -e BASE_URL=https://staging.api.subtrackr.com load-tests/run.js
```

## Metrics & Thresholds

We monitor the following key performance indicators (KPIs):

- **Response Time (P95)**: Must be `< 500ms` for API and `< 1500ms` for contract simulations.
- **Error Rate**: Must be `< 1%`.
- **Ramp-up**: Smoothly increase VUs to identify breaking points.

## CI Integration

Load tests are integrated into the GitHub Actions pipeline. The build will fail if thresholds are not met.

```yaml
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run k6 Load Test
        uses: grafana/k6-action@v0.2.0
        with:
          filename: load-tests/run.js
          flags: --env SCENARIO=subscription
```

## Metrics Explanation

- **VUs**: Virtual Users (simulated concurrent users).
- **Iterations**: Total number of times the test script was executed.
- **http_req_duration**: Total time for the request (includes DNS, TCP, and server processing).
- **checks**: Success rate of assertions within the tests.
