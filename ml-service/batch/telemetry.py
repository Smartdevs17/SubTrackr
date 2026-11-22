"""Observability for the scoring batcher (Issue #2078).

The protocol matches the existing churn pre-flight telemetry shape, so the
same JSON log sink (or a real metrics client) can be injected without the
batcher depending on either.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Protocol


class BatchTelemetry(Protocol):
    def counter(self, name: str, **labels: Any) -> None:
        ...

    def gauge(self, name: str, value: float, **labels: Any) -> None:
        ...


class StructuredTelemetry:
    """JSON log sink that works without a metrics agent installed."""

    def __init__(self, logger_name: str = "ml.batch") -> None:
        self._logger = logging.getLogger(logger_name)

    def _emit(self, kind: str, name: str, **labels: Any) -> None:
        self._logger.info(
            json.dumps({"kind": kind, "metric": name, **labels}, default=str, sort_keys=True)
        )

    def counter(self, name: str, **labels: Any) -> None:
        self._emit("counter", name, **labels)

    def gauge(self, name: str, value: float, **labels: Any) -> None:
        self._emit("gauge", name, value=value, **labels)
