# Chaos Engineering — Recovery Procedures

## Experiments

| Experiment            | Failure Simulated                      | Recovery Mechanism                                            |
| --------------------- | -------------------------------------- | ------------------------------------------------------------- |
| `network-partition`   | Random connection refusals (80 % rate) | Exponential back-off retry (up to 5 attempts)                 |
| `service-degradation` | Persistent service timeout             | Circuit breaker (opens after 3 failures, resets after 100 ms) |
| `failure-injection`   | 30 % random billing charge failures    | Fault-tolerant loop; success rate ≥ 50 % required             |

## Running Experiments

```bash
# Run all chaos tests
npm test -- --testPathPattern=chaos

# Run a single experiment
npm test -- --testPathPattern=chaos/__tests__/network-partition
```

## Recovery Playbook

### Network Partition

1. Confirm the failure via logs (`Network partition: connection refused`).
2. The retry layer handles transient failures automatically.
3. If failures persist beyond 5 retries, escalate to on-call — check Stellar RPC node health.
4. Switch to a backup RPC endpoint in `src/config/evm.ts`.

### Service Degradation

1. Circuit breaker opens automatically after 3 consecutive failures.
2. All requests fast-fail with `Circuit open: service unavailable` until the reset timeout elapses.
3. After the timeout the circuit enters half-open state — one probe request is allowed.
4. If the probe succeeds, the circuit closes and normal traffic resumes.
5. If the probe fails, the circuit re-opens. Repeat until the upstream service recovers.

### Failure Injection (Billing)

1. Failed billing charges are logged with the subscription ID.
2. The billing scheduler retries failed charges on the next cycle.
3. After 3 consecutive failed cycles, the subscription is flagged `payment_failed` and the user is notified.
4. Manual re-trigger is available via the admin panel or `subscriptionStore.retryCharge(id)`.

## CI/CD Integration

Chaos tests run as part of the standard Jest suite in the `typescript-tests` CI job.
All experiments must pass before a PR can be merged.

## Adding New Experiments

1. Create `chaos/experiments/<name>.ts` exporting a `run<Name>Experiment(): Promise<ChaosResult>` function.
2. Add a corresponding test in `chaos/__tests__/<name>.test.ts`.
3. Register the experiment in `chaos/runner.ts → runAllExperiments()`.
4. Document the recovery procedure in this file.
