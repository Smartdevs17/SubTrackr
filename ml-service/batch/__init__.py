"""Micro-batched ML scoring for SubTrackr (Issue #2078).

The package is deliberately dependency-free: it uses only the standard library
so it can run beside the FastAPI service without adding an async test framework
or a queue worker. See ``README.md`` for the operating contract.
"""

from .batcher import BatchBatcher, BatchOutcome, BatchRequest, Scorer
from .config import BatchConfig
from .inference import InferenceBatchScorer
from .startup import StartupGate
from .telemetry import BatchTelemetry, StructuredTelemetry

__all__ = [
    "BatchBatcher",
    "BatchConfig",
    "BatchOutcome",
    "BatchRequest",
    "BatchTelemetry",
    "InferenceBatchScorer",
    "Scorer",
    "StartupGate",
    "StructuredTelemetry",
]
