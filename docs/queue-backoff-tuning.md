# Queue backoff autotuning

**Issue:** #1286 — Implement queue backoff tuning automation

`scripts/queue-backoff-tune.js` reads a queue metrics snapshot and proposes a
retention/backoff policy for the BullMQ queues, so retry tuning stops being a
guess someone makes during an incident.

## Quick start

```bash
# Dry run against a snapshot file (no changes written)
npm run queue:backoff:tune

# Same thing, reading the snapshot from stdin
cat snapshot.json | npm run queue:backoff:tune:stdin

# Persist the tuned policy
node scripts/queue-backoff-tune.js \
  --input snapshot.json \
  --apply --config config/queue-backoff.policy.json

# Fail the pipeline while tuning is still pending
node scripts/queue-backoff-tune.js --input snapshot.json --fail-on-change
```

A runnable sample lives at `config/queue-snapshot.sample.json`.

## Input

The snapshot is plain JSON, so it can come from a metrics endpoint, a `redis-cli`
dump or a log query:

```json
{
  "generatedAt": "2026-09-28T12:00:00Z",
  "queues": {
    "critical": { "enqueued": 100, "processed": 80, "failed": 4, "waiting": 5, "delayed": 2, "dlq": 1, "meanLatencyMs": 1200 },
    "normal":   { "enqueued": 900, "processed": 700, "failed": 60, "waiting": 120, "delayed": 80, "dlq": 20, "meanLatencyMs": 5400 }
  },
  "maxQueueSize": 1000
}
```

Only `enqueued` and `processed` are required per queue. Missing fields default
to zero, so a partial Prometheus scrape degrades to a weaker signal rather than
crashing.

## How the recommendation is made

Four signals are extracted per queue, each normalised so that **0.0 means healthy
and idle** and **>1.0 means over the tuning ceiling**:

| Signal      | Definition                                                          |
| ----------- | ------------------------------------------------------------------- |
| `failureRate` | `(enqueued - processed) / enqueued`, blended with DLQ depth         |
| `pressure`  | worst queue depth as a fraction of `maxQueueSize`                   |
| `latency`   | mean wait time against the per-priority latency SLO                 |
| `demand`    | geometric blend of the three, capped                               |

Those signals become a single `demandFactor`, and the factor drives each knob:

- **Under pressure / failing** → longer `baseDelayMs`, steeper `backoffMultiplier`,
  higher `maxDelayMs`. Retries stop hammering an already-saturated dependency and
  let it recover.
- **Healthy and idle** → relax toward the floor so a queue that is actually
  draining does not keep the pessimistic values from the last incident.

Four properties keep the output safe to apply unattended:

1. **Bounds.** Every value is clamped to `[min, max]` safety bounds, so a bad
  snapshot cannot produce an absurd policy.
2. **Bounded movement.** A single run moves each knob by at most `maxStep`, so
   the policy converges over a few runs instead of oscillating.
3. **Hysteresis.** A dead-band suppresses changes when the signals sit near the
   target, which is what stops the tuner from rewriting the config every run.
4. **Sample floor.** Below `minSample` the tuner refuses to tune at all and
   reports `insufficient-data`. A 10-job snapshot is noise, not evidence.

## Exit codes

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | a policy was produced — including one that recommends changes         |
| `1`  | a change is pending **and** `--fail-on-change` was passed            |
| `2`  | usage error, unreadable input, or malformed JSON                     |
| `3`  | unexpected failure                                                   |

A recommendation is deliberately **not** a failure: `npm run queue:backoff:tune`
stays green so it can run in any pipeline, and alerting is opt-in through
`--fail-on-change`.

## Verifying the current policy is already tuned

`--apply` always exits `0`, because it applied something. To assert that the
committed policy has converged, run the check *without* `--apply`:

```bash
node scripts/queue-backoff-tune.js --input snapshot.json \
  --config config/queue-backoff.policy.json --fail-on-change
```

## Applying the result

The tuner writes the policy JSON; wiring it into the BullMQ producer options is
a deliberate, separate step. The emitted shape mirrors the priority keys used by
the queue producers:

```json
{
  "baseDelayMs": 1350,
  "backoffMultiplier": 2.3,
  "maxDelayMs": 90000,
  "maxAttempts": { "critical": 8, "high": 6, "normal": 5, "low": 3 }
}
```

`maxAttempts` is preserved from the current policy on purpose. Raising it means
more retries, which is the opposite of what a saturated system needs — tune
backoff, not attempt counts.

## Tests

```bash
npx jest scripts/__tests__/queue-backoff-tune.test.js
```

Covers signal extraction, the dead-band, bound clamping, convergence over
repeated runs, and every CLI exit path.
