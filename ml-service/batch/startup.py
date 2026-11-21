"""Single-flight startup for expensive model initialization (Issue #2078).

Concurrent first requests normally race into the same cold-start work. The
gate makes every caller await one shared initialization task and lets a later
request retry if that initialization failed.
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

from .telemetry import BatchTelemetry

Initializer = Callable[[], Awaitable[None]]


class StartupGate:
    """Runs an async initializer at most once for concurrent callers."""

    def __init__(
        self,
        initializer: Initializer,
        telemetry: BatchTelemetry | None = None,
    ) -> None:
        self._initializer = initializer
        self._telemetry = telemetry
        self._ready = False
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None

    @property
    def ready(self) -> bool:
        return self._ready

    async def ensure_ready(self, *, force: bool = False) -> None:
        """Return once initialization succeeded; propagate its error otherwise."""

        if self._ready and not force:
            return

        async with self._lock:
            if self._ready and not force:
                return
            if self._task is None or self._task.done():
                self._task = asyncio.create_task(self._initialize())
            task = self._task

        await asyncio.shield(task)

    async def _initialize(self) -> None:
        if self._telemetry:
            self._telemetry.counter("ml_batch_cold_start", ready=self._ready)
        try:
            await self._initializer()
        except BaseException:
            self._ready = False
            if self._telemetry:
                self._telemetry.counter("ml_batch_cold_start_failed")
            raise
        self._ready = True
        if self._telemetry:
            self._telemetry.counter("ml_batch_cold_start_completed")
            self._telemetry.gauge("ml_batch_ready", 1)
