"""Adapter from the batcher to the existing typed inference client.

The client is synchronous and already exposes a batch endpoint with
per-item ``ok`` flags. Running it in a worker thread lets the async batcher
coalesce callers without changing ``inference_client.py``.
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Mapping, Protocol, Sequence

from .batcher import BatchOutcome, BatchRequest


class ChurnBatchClient(Protocol):
    def predict_churn(self, subscriber: str, features: Any) -> Any:
        ...

    def predict_churn_batch(self, items: Sequence[tuple[str, Any]]) -> Any:
        ...


class InferenceBatchScorer:
    """Batch scorer backed by ``InferenceClient.predict_churn_batch``."""

    def __init__(
        self,
        client: ChurnBatchClient,
        to_thread: Callable[..., Awaitable[Any]] = asyncio.to_thread,
    ) -> None:
        self._client = client
        self._to_thread = to_thread

    async def score_batch(self, requests: Sequence[BatchRequest]) -> Sequence[Any]:
        if not requests:
            return ()
        items = [(request.key, request.payload) for request in requests]
        response = await self._to_thread(self._client.predict_churn_batch, items)
        results = response.results if hasattr(response, "results") else response
        if isinstance(results, Mapping):
            results = results.get("results", [])
        return list(results or [])

    async def score_one(self, request: BatchRequest) -> BatchOutcome:
        subscriber, features = _unpack(request.payload)
        value = await self._to_thread(self._client.predict_churn, subscriber, features)
        return BatchOutcome(key=request.key, ok=True, value=value, source="fallback")


def _unpack(payload: Any) -> tuple[str, Any]:
    if isinstance(payload, Mapping):
        return str(payload["subscriber"]), payload["features"]
    if isinstance(payload, (tuple, list)) and len(payload) == 2:
        return str(payload[0]), payload[1]
    raise ValueError("scoring payload must be (subscriber, features) or a mapping")
