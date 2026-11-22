"""Bounded micro-batching for async ML scoring requests (Issue #2078).

Requests arriving in the same short window are coalesced into one call to the
scorer, so a cold model pays its startup cost once instead of once per caller.
The queue, batch size and caller wait are all bounded, and a failed batch is
isolated to the individual requests that made it up.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, replace
from typing import Any, Mapping, Protocol, Sequence

from .config import BatchConfig
from .startup import StartupGate
from .telemetry import BatchTelemetry


@dataclass(frozen=True)
class BatchRequest:
    """One scoring request. ``key`` is echoed in its outcome for correlation."""

    key: str
    payload: Any


@dataclass(frozen=True)
class BatchOutcome:
    """Per-request result; a batch never fails all-or-nothing to its callers."""

    key: str
    ok: bool
    value: Any = None
    error: str | None = None
    source: str = "batch"  # batch | fallback | timeout | queue_full | error
    duration_ms: float = 0.0


class Scorer(Protocol):
    """The batch-capable scoring surface required by :class:`BatchBatcher`."""

    async def score_batch(self, requests: Sequence[BatchRequest]) -> Sequence[Any]:
        ...


@dataclass
class _PendingItem:
    request: BatchRequest
    future: asyncio.Future[BatchOutcome]


class BatchBatcher:
    """Coalesce concurrent scoring calls into bounded batches."""

    def __init__(
        self,
        scorer: Scorer,
        config: BatchConfig | None = None,
        telemetry: BatchTelemetry | None = None,
        startup_gate: StartupGate | None = None,
        now: Any = time.monotonic,
    ) -> None:
        self._scorer = scorer
        self._config = config or BatchConfig()
        self._telemetry = telemetry
        self._startup_gate = startup_gate
        self._now = now
        self._pending: list[_PendingItem] = []
        self._timer: asyncio.Task[None] | None = None
        self._in_flight: set[asyncio.Task[None]] = set()
        self._closed = False

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    @property
    def in_flight_count(self) -> int:
        return len(self._in_flight)

    async def score(
        self, payload_or_request: Any, *, key: str | None = None
    ) -> BatchOutcome:
        """Score one request, waiting at most ``request_timeout_ms``."""

        if self._closed:
            return self._failure(key or "", "batcher is closed", "error")

        if self._startup_gate is not None:
            try:
                await self._startup_gate.ensure_ready()
            except Exception as exc:  # startup failure is per-caller, not fatal
                return self._failure(key or "", f"startup failed: {exc}", "error")

        request = (
            payload_or_request
            if isinstance(payload_or_request, BatchRequest)
            else BatchRequest(key=key or "", payload=payload_or_request)
        )
        loop = asyncio.get_running_loop()

        if len(self._pending) >= self._config.max_pending:
            self._count("ml_batch_queue_full", key=request.key)
            return self._failure(request.key, "batch queue is full", "queue_full")

        future: asyncio.Future[BatchOutcome] = loop.create_future()
        item = _PendingItem(request=request, future=future)
        self._pending.append(item)
        self._count("ml_batch_request_submitted", key=request.key)
        self._gauge_pending()

        if len(self._pending) >= self._config.max_batch_size:
            self._flush("size")
        elif self._timer is None:
            self._timer = loop.create_task(self._deadline_flush())

        try:
            return await asyncio.wait_for(
                asyncio.shield(future), timeout=self._config.request_timeout_seconds
            )
        except (TimeoutError, asyncio.TimeoutError):
            self._drop(item)
            self._count("ml_batch_request_timeout", key=request.key)
            return self._failure(request.key, "batch request timed out", "timeout")

    async def close(self) -> None:
        """Flush pending work and stop accepting requests."""

        self._closed = True
        if self._timer is not None:
            timer, self._timer = self._timer, None
            timer.cancel()
            try:
                await timer
            except asyncio.CancelledError:
                pass
        if self._pending:
            self._flush("close")
        if self._in_flight:
            await asyncio.gather(*tuple(self._in_flight), return_exceptions=True)

    def _failure(self, key: str, error: str, source: str) -> BatchOutcome:
        self._count("ml_batch_item_failed", key=key, source=source)
        return BatchOutcome(key=key, ok=False, error=error, source=source)

    def _count(self, name: str, **labels: Any) -> None:
        if self._telemetry is not None:
            self._telemetry.counter(name, **labels)

    def _gauge_pending(self) -> None:
        if self._telemetry is not None:
            self._telemetry.gauge("ml_batch_pending", len(self._pending))

    def _drop(self, item: _PendingItem) -> None:
        if item in self._pending:
            self._pending.remove(item)
            self._gauge_pending()

    async def _deadline_flush(self) -> None:
        try:
            await asyncio.sleep(self._config.max_wait_seconds)
        except asyncio.CancelledError:
            return
        self._timer = None
        if self._pending:
            self._flush("deadline")

    def _flush(self, reason: str) -> None:
        if self._timer is not None:
            timer, self._timer = self._timer, None
            if timer is not asyncio.current_task():
                timer.cancel()

        batch = tuple(self._pending)
        self._pending.clear()
        self._gauge_pending()
        if not batch:
            return

        self._count("ml_batch_flushed", reason=reason, size=len(batch))
        started = self._now()
        loop = asyncio.get_running_loop()
        task = loop.create_task(self._run_batch(batch, started))
        self._in_flight.add(task)
        task.add_done_callback(self._in_flight.discard)

    async def _run_batch(
        self, batch: tuple[_PendingItem, ...], started: float
    ) -> None:
        requests = tuple(item.request for item in batch)
        try:
            results = await asyncio.wait_for(
                self._scorer.score_batch(requests),
                timeout=self._config.request_timeout_seconds,
            )
            outcomes = self._normalise(batch, results, started)
        except asyncio.CancelledError:
            outcomes = tuple(
                BatchOutcome(
                    key=item.request.key,
                    ok=False,
                    error="batch cancelled",
                    source="error",
                    duration_ms=self._elapsed(started),
                )
                for item in batch
            )
            self._resolve_all(batch, outcomes)
            raise
        except Exception as exc:
            outcomes = await self._fallback(batch, exc, started)

        self._resolve_all(batch, outcomes)

    def _elapsed(self, started: float) -> float:
        return max(0.0, (self._now() - started) * 1_000.0)

    def _normalise(
        self,
        batch: tuple[_PendingItem, ...],
        results: Sequence[Any],
        started: float,
    ) -> tuple[BatchOutcome, ...]:
        values = list(results) if results is not None else []
        if len(values) != len(batch):
            self._count(
                "ml_batch_response_mismatch",
                expected=len(batch),
                received=len(values),
            )

        outcomes: list[BatchOutcome] = []
        for index, item in enumerate(batch):
            if index >= len(values):
                outcomes.append(
                    BatchOutcome(
                        key=item.request.key,
                        ok=False,
                        error="batch response missing this request",
                        source="error",
                        duration_ms=self._elapsed(started),
                    )
                )
                continue
            outcomes.append(self._coerce(item.request.key, values[index], started))
        return tuple(outcomes)

    def _coerce(self, key: str, result: Any, started: float) -> BatchOutcome:
        duration_ms = self._elapsed(started)
        if isinstance(result, BatchOutcome):
            outcome = result if result.key else replace(result, key=key)
            if outcome.duration_ms == 0.0:
                outcome = replace(outcome, duration_ms=duration_ms)
            return outcome
        if isinstance(result, BaseException):
            return BatchOutcome(
                key=key, ok=False, error=str(result), source="error", duration_ms=duration_ms
            )
        if isinstance(result, Mapping):
            ok = bool(result.get("ok", True))
            if ok:
                return BatchOutcome(
                    key=key, ok=True, value=result.get("value"), source="batch", duration_ms=duration_ms
                )
            return BatchOutcome(
                key=key,
                ok=False,
                error=str(result.get("error") or "scoring failed"),
                source="batch",
                duration_ms=duration_ms,
            )
        return BatchOutcome(key=key, ok=True, value=result, source="batch", duration_ms=duration_ms)

    async def _fallback(
        self, batch: tuple[_PendingItem, ...], exc: Exception, started: float
    ) -> tuple[BatchOutcome, ...]:
        scorer_one = getattr(self._scorer, "score_one", None)
        if not callable(scorer_one):
            self._count("ml_batch_failed", size=len(batch), fallback=False)
            return tuple(
                BatchOutcome(
                    key=item.request.key,
                    ok=False,
                    error=f"batch scoring failed: {type(exc).__name__}: {exc}",
                    source="error",
                    duration_ms=self._elapsed(started),
                )
                for item in batch
            )

        self._count("ml_batch_fallback", size=len(batch))

        async def attempt(request: BatchRequest) -> BatchOutcome:
            try:
                value = await asyncio.wait_for(
                    scorer_one(request), timeout=self._config.request_timeout_seconds
                )
                return self._coerce(request.key, value, started)
            except Exception as single_error:
                return BatchOutcome(
                    key=request.key,
                    ok=False,
                    error=f"fallback scoring failed: {single_error}",
                    source="fallback",
                    duration_ms=self._elapsed(started),
                )

        results = await asyncio.gather(
            *(attempt(item.request) for item in batch), return_exceptions=True
        )
        outcomes: list[BatchOutcome] = []
        for item, result in zip(batch, results):
            if isinstance(result, BaseException):
                outcomes.append(
                    BatchOutcome(
                        key=item.request.key,
                        ok=False,
                        error=f"fallback scoring failed: {result}",
                        source="fallback",
                        duration_ms=self._elapsed(started),
                    )
                )
            else:
                outcome = result
                outcomes.append(
                    replace(outcome, source="fallback") if outcome.ok else outcome
                )
        return tuple(outcomes)

    def _resolve_all(
        self, batch: tuple[_PendingItem, ...], outcomes: Sequence[BatchOutcome]
    ) -> None:
        for item, outcome in zip(batch, outcomes):
            if not item.future.done():
                item.future.set_result(outcome)
            if outcome.ok:
                self._count("ml_batch_item_ok", key=outcome.key, source=outcome.source)
            else:
                self._count("ml_batch_item_failed", key=outcome.key, source=outcome.source)
