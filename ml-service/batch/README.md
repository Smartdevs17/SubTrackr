# Micro-batched ML scoring (Issue #2078)

`batch/` coalesces concurrent scoring calls into bounded batches so a cold
model pays its startup cost once instead of once per caller. It is
dependency-free (standard library only) and does not require a queue worker or
an async test framework.

## Usage

```python
import asyncio

from batch import BatchBatcher, BatchConfig, InferenceBatchScorer, StartupGate
from inference_client import InferenceClient

client = InferenceClient("http://localhost:8000", timeout=5)
scorer = InferenceBatchScorer(client)

async def warm_model() -> None:
    await asyncio.to_thread(client.health)  # any one-time async initializer

gate = StartupGate(warm_model)  # optional
batcher = BatchBatcher(scorer, BatchConfig.from_env(), startup_gate=gate)

outcome = await batcher.score(("subscriber-1", features), key="subscriber-1")
if outcome.ok:
    print(outcome.value)
else:
    print(outcome.source, outcome.error)

await batcher.close()  # flush pending requests on shutdown
```

`score` accepts a payload or a `BatchRequest(key, payload)`. Outcomes carry the
request key so callers can correlate results even when a batch is split.

## Contract

- **Bounded window:** requests arriving within `max_wait_ms` (default 15 ms)
  are coalesced; a batch also flushes as soon as it reaches `max_batch_size`
  (default 32, capped at the `/v1/churn/predict/batch` limit of 500).
- **Bounded queue:** at most `max_pending` requests (default 500) may wait for
  a batch. Overflow is rejected with a `queue_full` outcome instead of growing
  memory without limit.
- **Bounded latency:** each caller waits at most `request_timeout_ms`
  (default 5 s), including time spent in the scorer. Timeouts yield a
  `timeout` outcome and are removed from the pending batch.
- **Partial failures:** per-item `{"ok": false, "error": ...}` results are
  preserved. If the whole batch call fails and the scorer implements
  `score_one`, each request is retried individually (`fallback` source);
  otherwise each caller receives its own error outcome. A short or missing
  response never marks the other callers successful by mistake.
- **Cold start:** `StartupGate` runs one shared initializer for concurrent
  callers. A failed initialization is retryable and is reported per caller
  without taking the batcher down.
- **Shutdown:** `close()` flushes pending requests and awaits in-flight work.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `ML_BATCH_MAX_SIZE` | `32` | Maximum items in one batch (1–500) |
| `ML_BATCH_MAX_WAIT_MS` | `15` | Coalescing window before a flush |
| `ML_BATCH_MAX_PENDING` | `500` | Maximum queued requests |
| `ML_BATCH_REQUEST_TIMEOUT_MS` | `5000` | Per-caller deadline, including scoring |

Invalid values fall back to defaults; construct `BatchConfig` directly for
strict validation.

## Observability

Inject any object with `counter(name, **labels)` and `gauge(name, value,
**labels)` methods. `StructuredTelemetry` emits JSON log records with the same
shape as the churn pre-flight telemetry. Events:
`ml_batch_request_submitted`, `ml_batch_flushed` (reason/size),
`ml_batch_item_ok`, `ml_batch_item_failed`, `ml_batch_queue_full`,
`ml_batch_request_timeout`, `ml_batch_response_mismatch`, `ml_batch_fallback`,
`ml_batch_failed`, `ml_batch_cold_start`, `ml_batch_cold_start_completed`,
`ml_batch_cold_start_failed`, and the `ml_batch_pending` gauge.

## Tests

```bash
python3 -m unittest discover -s ml-service/batch/tests -v
# or, with pytest installed:
pytest ml-service/batch/tests -v
```
