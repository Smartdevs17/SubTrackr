"""Configuration for the scoring batcher (Issue #2078).

All limits are bounded so a burst of traffic can never grow the in-memory
queue, the batch size, or the time a caller waits without an answer.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

# The existing /v1/churn/predict/batch endpoint accepts at most 500 items.
SERVER_MAX_BATCH_SIZE = 500
DEFAULT_MAX_BATCH_SIZE = 32
DEFAULT_MAX_WAIT_MS = 15
DEFAULT_MAX_PENDING = 500
DEFAULT_REQUEST_TIMEOUT_MS = 5_000


@dataclass(frozen=True)
class BatchConfig:
    """Tunable, validated limits for :class:`~batch.batcher.BatchBatcher`."""

    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE
    max_wait_ms: int = DEFAULT_MAX_WAIT_MS
    max_pending: int = DEFAULT_MAX_PENDING
    request_timeout_ms: int = DEFAULT_REQUEST_TIMEOUT_MS

    def __post_init__(self) -> None:
        if self.max_batch_size < 1:
            raise ValueError("max_batch_size must be at least 1")
        if self.max_batch_size > SERVER_MAX_BATCH_SIZE:
            raise ValueError(f"max_batch_size cannot exceed {SERVER_MAX_BATCH_SIZE}")
        if self.max_wait_ms < 0:
            raise ValueError("max_wait_ms cannot be negative")
        if self.max_pending < 1:
            raise ValueError("max_pending must be at least 1")
        if self.request_timeout_ms < 1:
            raise ValueError("request_timeout_ms must be at least 1")

    @property
    def max_wait_seconds(self) -> float:
        return self.max_wait_ms / 1_000.0

    @property
    def request_timeout_seconds(self) -> float:
        return self.request_timeout_ms / 1_000.0

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "BatchConfig":
        """Build a config from ``ML_BATCH_*`` environment variables.

        Invalid or non-numeric values fall back to the safe defaults. Callers
        that want a hard failure should construct ``BatchConfig`` directly.
        """

        env = os.environ if environ is None else environ

        def number(name: str, default: int) -> int:
            raw = env.get(name)
            if raw is None:
                return default
            try:
                return int(raw)
            except (TypeError, ValueError):
                return default

        try:
            return cls(
                max_batch_size=number("ML_BATCH_MAX_SIZE", DEFAULT_MAX_BATCH_SIZE),
                max_wait_ms=number("ML_BATCH_MAX_WAIT_MS", DEFAULT_MAX_WAIT_MS),
                max_pending=number("ML_BATCH_MAX_PENDING", DEFAULT_MAX_PENDING),
                request_timeout_ms=number(
                    "ML_BATCH_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS
                ),
            )
        except ValueError:
            # A misconfigured environment must not take scoring down.
            return cls()
