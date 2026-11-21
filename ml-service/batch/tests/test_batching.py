"""Tests for bounded ML scoring batches (Issue #2078).

Written with ``unittest.TestCase`` + ``asyncio.run`` so they run both under
pytest and in a bare checkout without pytest-asyncio installed.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Callable, Sequence

ML_SERVICE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ML_SERVICE_ROOT not in sys.path:
    sys.path.insert(0, ML_SERVICE_ROOT)

from batch import (  # noqa: E402
    BatchBatcher,
    BatchConfig,
    BatchOutcome,
    BatchRequest,
    InferenceBatchScorer,
    StartupGate,
)
from batch.telemetry import BatchTelemetry  # noqa: E402


class RecordingTelemetry:
    def __init__(self) -> None:
        self.counters: list[tuple[str, dict[str, Any]]] = []
        self.gauges: list[tuple[str, float, dict[str, Any]]] = []

    def counter(self, name: str, **labels: Any) -> None:
        self.counters.append((name, labels))

    def gauge(self, name: str, value: float, **labels: Any) -> None:
        self.gauges.append((name, value, labels))

    def names(self) -> list[str]:
        return [name for name, _ in self.counters]


class FakeScorer:
    def __init__(
        self,
        handler: Callable[[Sequence[BatchRequest]], Any] | None = None,
        *,
        single: Callable[[BatchRequest], Any] | None = None,
    ) -> None:
        self.calls: list[tuple[BatchRequest, ...]] = []
        self.single_calls: list[BatchRequest] = []
        self._handler = handler
        self._single = single

    async def score_batch(self, requests: Sequence[BatchRequest]) -> Sequence[Any]:
        self.calls.append(tuple(requests))
        if self._handler is None:
            return [{"ok": True, "value": request.key} for request in requests]
        result = self._handler(requests)
        return await result if asyncio.iscoroutine(result) else result

    async def score_one(self, request: BatchRequest) -> Any:
        self.single_calls.append(request)
        if self._single is None:
            return request.key
        result = self._single(request)
        return await result if asyncio.iscoroutine(result) else result


def config(**overrides: Any) -> BatchConfig:
    values: dict[str, Any] = {
        "max_batch_size": 4,
        "max_wait_ms": 20,
        "max_pending": 16,
        "request_timeout_ms": 1_000,
    }
    values.update(overrides)
    return BatchConfig(**values)


class ConfigTests(unittest.TestCase):
    def test_rejects_invalid_limits(self) -> None:
        with self.assertRaises(ValueError):
            BatchConfig(max_batch_size=0)
        with self.assertRaises(ValueError):
            BatchConfig(max_batch_size=501)
        with self.assertRaises(ValueError):
            BatchConfig(max_pending=0)
        with self.assertRaises(ValueError):
            BatchConfig(request_timeout_ms=0)

    def test_env_parsing_and_fallback(self) -> None:
        parsed = BatchConfig.from_env(
            {
                "ML_BATCH_MAX_SIZE": "8",
                "ML_BATCH_MAX_WAIT_MS": "5",
                "ML_BATCH_MAX_PENDING": "20",
                "ML_BATCH_REQUEST_TIMEOUT_MS": "3000",
            }
        )
        self.assertEqual(parsed.max_batch_size, 8)
        self.assertEqual(parsed.max_wait_ms, 5)
        self.assertEqual(parsed.request_timeout_seconds, 3.0)

        self.assertEqual(BatchConfig.from_env({"ML_BATCH_MAX_SIZE": "nope"}).max_batch_size, 32)
        self.assertEqual(BatchConfig.from_env({"ML_BATCH_MAX_SIZE": "-1"}).max_batch_size, 32)


class BatcherTests(unittest.TestCase):
    def test_coalesces_concurrent_requests_into_one_batch(self) -> None:
        async def scenario() -> None:
            started = asyncio.Event()
            release = asyncio.Event()
            seen: list[tuple[BatchRequest, ...]] = []

            async def handler(requests: Sequence[BatchRequest]) -> Sequence[Any]:
                seen.append(tuple(requests))
                started.set()
                await release.wait()
                return [request.key for request in requests]

            batcher = BatchBatcher(
                FakeScorer(handler),
                config(max_batch_size=10, max_wait_ms=50),
                telemetry=RecordingTelemetry(),
            )
            tasks = [asyncio.create_task(batcher.score(i, key=f"key-{i}")) for i in range(5)]
            await asyncio.wait_for(started.wait(), timeout=1)
            release.set()
            results = await asyncio.gather(*tasks)
            await batcher.close()

            self.assertEqual(len(seen), 1)
            self.assertEqual(len(seen[0]), 5)
            self.assertTrue(all(result.ok for result in results))
            self.assertEqual([result.value for result in results], [f"key-{i}" for i in range(5)])

        asyncio.run(scenario())

    def test_flushes_immediately_at_max_batch_size(self) -> None:
        async def scenario() -> None:
            started = asyncio.Event()

            async def handler(requests: Sequence[BatchRequest]) -> Sequence[Any]:
                started.set()
                return [request.key for request in requests]

            batcher = BatchBatcher(FakeScorer(handler), config(max_batch_size=3, max_wait_ms=5_000))
            tasks = [asyncio.create_task(batcher.score(i, key=str(i))) for i in range(3)]
            await asyncio.wait_for(started.wait(), timeout=0.5)
            results = await asyncio.gather(*tasks)
            await batcher.close()

            self.assertEqual([result.value for result in results], ["0", "1", "2"])

        asyncio.run(scenario())

    def test_preserves_partial_failures(self) -> None:
        async def scenario() -> None:
            def handler(requests: Sequence[BatchRequest]) -> Sequence[Any]:
                return [
                    {"ok": True, "value": "fine"}
                    if request.key == "a"
                    else {"ok": False, "error": "downstream 422"}
                    for request in requests
                ]

            scorer = FakeScorer(handler)
            batcher = BatchBatcher(scorer, config(max_batch_size=2))
            first = asyncio.create_task(batcher.score("x", key="a"))
            second = asyncio.create_task(batcher.score("y", key="b"))
            outcomes = await asyncio.gather(first, second)
            await batcher.close()

            self.assertTrue(outcomes[0].ok)
            self.assertEqual(outcomes[0].value, "fine")
            self.assertFalse(outcomes[1].ok)
            self.assertEqual(outcomes[1].error, "downstream 422")

        asyncio.run(scenario())

    def test_missing_results_are_isolated_failures(self) -> None:
        async def scenario() -> None:
            batcher = BatchBatcher(FakeScorer(lambda _: [{"ok": True, "value": 1}]), config())
            first = asyncio.create_task(batcher.score("x", key="a"))
            second = asyncio.create_task(batcher.score("y", key="b"))
            outcomes = await asyncio.gather(first, second)
            await batcher.close()

            self.assertTrue(outcomes[0].ok)
            self.assertFalse(outcomes[1].ok)
            self.assertEqual(outcomes[1].source, "error")

        asyncio.run(scenario())

    def test_batch_failure_falls_back_to_individual_scoring(self) -> None:
        async def scenario() -> None:
            def handler(requests: Sequence[BatchRequest]) -> Sequence[Any]:
                raise RuntimeError("batch endpoint unavailable")

            scorer = FakeScorer(handler)
            telemetry = RecordingTelemetry()
            batcher = BatchBatcher(scorer, config(), telemetry=telemetry)
            first = asyncio.create_task(batcher.score("x", key="a"))
            second = asyncio.create_task(batcher.score("y", key="b"))
            outcomes = await asyncio.gather(first, second)
            await batcher.close()

            self.assertTrue(all(outcome.ok for outcome in outcomes))
            self.assertEqual([outcome.source for outcome in outcomes], ["fallback", "fallback"])
            self.assertEqual(len(scorer.single_calls), 2)
            self.assertIn("ml_batch_fallback", telemetry.names())

        asyncio.run(scenario())

    def test_batch_failure_without_fallback_fails_each_request(self) -> None:
        async def scenario() -> None:
            class NoFallback:
                async def score_batch(self, requests: Sequence[BatchRequest]) -> Sequence[Any]:
                    raise RuntimeError("model load failed")

            batcher = BatchBatcher(NoFallback(), config())
            first = asyncio.create_task(batcher.score("x", key="a"))
            second = asyncio.create_task(batcher.score("y", key="b"))
            outcomes = await asyncio.gather(first, second)
            await batcher.close()

            self.assertTrue(all(not outcome.ok for outcome in outcomes))
            self.assertTrue(all("model load failed" in outcome.error for outcome in outcomes))

        asyncio.run(scenario())

    def test_queue_is_bounded(self) -> None:
        async def scenario() -> None:
            release = asyncio.Event()

            async def handler(requests: Sequence[BatchRequest]) -> Sequence[Any]:
                await release.wait()
                return [request.key for request in requests]

            telemetry = RecordingTelemetry()
            batcher = BatchBatcher(
                FakeScorer(handler), config(max_batch_size=10, max_pending=2), telemetry=telemetry
            )
            first = asyncio.create_task(batcher.score("a", key="a"))
            second = asyncio.create_task(batcher.score("b", key="b"))
            await asyncio.sleep(0)
            rejected = await batcher.score("c", key="c")
            release.set()
            accepted = await asyncio.gather(first, second)
            await batcher.close()

            self.assertEqual(rejected.source, "queue_full")
            self.assertEqual([result.key for result in accepted], ["a", "b"])
            self.assertIn("ml_batch_queue_full", telemetry.names())

        asyncio.run(scenario())

    def test_request_timeout_is_bounded(self) -> None:
        async def scenario() -> None:
            async def handler(requests: Sequence[BatchRequest]) -> Sequence[Any]:
                await asyncio.Event().wait()
                return []

            batcher = BatchBatcher(
                FakeScorer(handler), config(request_timeout_ms=30, max_wait_ms=1_000)
            )
            outcome = await batcher.score("x", key="slow")
            await batcher.close()

            self.assertEqual(outcome.source, "timeout")
            self.assertFalse(outcome.ok)
            self.assertEqual(batcher.pending_count, 0)

        asyncio.run(scenario())

    def test_close_flushes_pending_work(self) -> None:
        async def scenario() -> None:
            batcher = BatchBatcher(FakeScorer(), config(max_wait_ms=5_000))
            task = asyncio.create_task(batcher.score("x", key="a"))
            await asyncio.sleep(0)
            await batcher.close()
            outcome = await task

            self.assertTrue(outcome.ok)
            self.assertEqual(batcher.pending_count, 0)

        asyncio.run(scenario())

    def test_telemetry_reports_batch_observability(self) -> None:
        async def scenario() -> None:
            telemetry = RecordingTelemetry()
            batcher = BatchBatcher(FakeScorer(), config(), telemetry=telemetry)
            outcome = await batcher.score("x", key="a")
            await batcher.close()

            self.assertTrue(outcome.ok)
            self.assertIn("ml_batch_request_submitted", telemetry.names())
            self.assertIn("ml_batch_flushed", telemetry.names())
            self.assertIn("ml_batch_item_ok", telemetry.names())
            self.assertTrue(any(name == "ml_batch_pending" for name, _, _ in telemetry.gauges))
            self.assertGreater(outcome.duration_ms, 0.0)

        asyncio.run(scenario())


class StartupGateTests(unittest.TestCase):
    def test_concurrent_callers_share_one_initialization(self) -> None:
        async def scenario() -> None:
            calls = 0

            async def initializer() -> None:
                nonlocal calls
                calls += 1
                await asyncio.sleep(0.01)

            gate = StartupGate(initializer)
            await asyncio.gather(*(gate.ensure_ready() for _ in range(6)))

            self.assertEqual(calls, 1)
            self.assertTrue(gate.ready)

        asyncio.run(scenario())

    def test_failed_initialization_can_be_retried(self) -> None:
        async def scenario() -> None:
            calls = 0

            async def initializer() -> None:
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise RuntimeError("model download failed")

            gate = StartupGate(initializer)
            with self.assertRaises(RuntimeError):
                await gate.ensure_ready()
            self.assertFalse(gate.ready)
            await gate.ensure_ready()
            self.assertEqual(calls, 2)
            self.assertTrue(gate.ready)

        asyncio.run(scenario())

    def test_batcher_shares_cold_start_across_requests(self) -> None:
        async def scenario() -> None:
            calls = 0

            async def initializer() -> None:
                nonlocal calls
                calls += 1
                await asyncio.sleep(0.01)

            gate = StartupGate(initializer)
            batcher = BatchBatcher(FakeScorer(), config(), startup_gate=gate)
            outcomes = await asyncio.gather(*(batcher.score(i, key=str(i)) for i in range(4)))
            await batcher.close()

            self.assertEqual(calls, 1)
            self.assertTrue(all(outcome.ok for outcome in outcomes))

        asyncio.run(scenario())

    def test_startup_failure_is_reported_per_request(self) -> None:
        async def scenario() -> None:
            async def initializer() -> None:
                raise RuntimeError("model unavailable")

            batcher = BatchBatcher(
                FakeScorer(), config(), startup_gate=StartupGate(initializer)
            )
            outcome = await batcher.score("x", key="a")
            await batcher.close()

            self.assertFalse(outcome.ok)
            self.assertIn("model unavailable", outcome.error)

        asyncio.run(scenario())


class InferenceAdapterTests(unittest.TestCase):
    def test_adapts_sync_client_batch_and_single_calls(self) -> None:
        async def scenario() -> None:
            class FakeClient:
                def __init__(self) -> None:
                    self.batches: list[Sequence[tuple[str, Any]]] = []
                    self.singles: list[tuple[str, Any]] = []

                def predict_churn_batch(self, items: Sequence[tuple[str, Any]]) -> Any:
                    self.batches.append(items)
                    return {
                        "results": [
                            {"ok": True, "value": subscriber} if index == 0 else {"ok": False, "error": "bad features"}
                            for index, (subscriber, _) in enumerate(items)
                        ]
                    }

                def predict_churn(self, subscriber: str, features: Any) -> Any:
                    self.singles.append((subscriber, features))
                    return {"risk": "low"}

            client = FakeClient()
            scorer = InferenceBatchScorer(client)
            results = await scorer.score_batch(
                [BatchRequest("a", ("a", {})), BatchRequest("b", ("b", {}))]
            )
            single = await scorer.score_one(BatchRequest("c", {"subscriber": "c", "features": {}}))

            self.assertEqual(len(client.batches), 1)
            self.assertTrue(results[0]["ok"])
            self.assertFalse(results[1]["ok"])
            self.assertEqual(single.value, {"risk": "low"})
            self.assertEqual(client.singles, [("c", {})])

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
