"""SubTrackr ML inference service with OpenTelemetry distributed tracing.

This service is a hop in the end-to-end trace: the mobile app and backend
propagate W3C `traceparent` to us, and we emit spans for the three phases the
acceptance criteria call out — model loading, feature computation, and
inference — so per-request ML latency is attributable in the flame graph.

Spans are exported to the OpenTelemetry collector via OTLP/HTTP. Sampling and
the collector endpoint are configured through standard OTEL_* env vars so this
service behaves consistently with the JS services.

Run:
    pip install -r requirements.txt
    uvicorn main:app --port 8200
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict

from fastapi import FastAPI, Request
from pydantic import BaseModel

from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import (
    ParentBased,
    TraceIdRatioBased,
)
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator


# ── Tracer setup ──────────────────────────────────────────────────────────────

SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "subtrackr-ml")
SAMPLE_RATIO = float(os.getenv("OTEL_TRACES_SAMPLER_RATIO", "0.1"))
OTLP_ENDPOINT = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")


def _build_tracer_provider() -> TracerProvider:
    resource = Resource.create({"service.name": SERVICE_NAME})
    # ParentBased: honor the upstream sampling decision so traces stay whole
    # across service boundaries; fall back to ratio sampling for root spans.
    provider = TracerProvider(
        resource=resource,
        sampler=ParentBased(root=TraceIdRatioBased(SAMPLE_RATIO)),
    )
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{OTLP_ENDPOINT}/v1/traces"))
    )
    return provider


trace.set_tracer_provider(_build_tracer_provider())
tracer = trace.get_tracer(__name__)
_propagator = TraceContextTextMapPropagator()

app = FastAPI(title="SubTrackr ML Service")


# ── Model lifecycle (traced) ──────────────────────────────────────────────────

_MODEL: Dict[str, Any] | None = None


def _load_model() -> Dict[str, Any]:
    """Load the churn/recommendation model. Traced as its own span because cold
    loads dominate first-request latency and must be visible in the flame graph."""
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with tracer.start_as_current_span("ml.model.load") as span:
        span.set_attribute("ml.model.name", "churn-v3")
        # Simulated load — a real impl would read weights from disk/object store.
        time.sleep(0.02)
        _MODEL = {"name": "churn-v3", "version": 3, "loaded_at": time.time()}
        span.set_attribute("ml.model.version", _MODEL["version"])
    return _MODEL


# ── Request / response models ──────────────────────────────────────────────────

class PredictRequest(BaseModel):
    subscription_id: str
    features: Dict[str, float]


class PredictResponse(BaseModel):
    subscription_id: str
    churn_probability: float
    model_version: int
    trace_id: str


def _extract_context(request: Request) -> Context:
    """Adopt the incoming W3C trace context so this request joins the caller's
    distributed trace instead of starting a disconnected one."""
    return _propagator.extract(carrier=dict(request.headers))


def _compute_features(raw: Dict[str, float]) -> Dict[str, float]:
    with tracer.start_as_current_span("ml.feature.compute") as span:
        span.set_attribute("ml.feature.count", len(raw))
        # Deterministic, cheap feature engineering placeholder.
        normalized = {k: float(v) / (1.0 + abs(float(v))) for k, v in raw.items()}
        return normalized


def _infer(model: Dict[str, Any], features: Dict[str, float]) -> float:
    with tracer.start_as_current_span("ml.inference") as span:
        span.set_attribute("ml.model.name", model["name"])
        span.set_attribute("ml.model.version", model["version"])
        score = sum(features.values()) / (len(features) or 1)
        probability = 1.0 / (1.0 + pow(2.718281828, -score))
        span.set_attribute("ml.inference.score", probability)
        return probability


@app.post("/v1/predict/churn", response_model=PredictResponse)
def predict_churn(body: PredictRequest, request: Request) -> PredictResponse:
    ctx = _extract_context(request)
    # The server span is the parent for model/feature/inference child spans and is
    # rooted in the upstream context, attributing ML latency to the user request.
    with tracer.start_as_current_span(
        "POST /v1/predict/churn", context=ctx, kind=trace.SpanKind.SERVER
    ) as span:
        span.set_attribute("subscription.id", body.subscription_id)

        model = _load_model()
        features = _compute_features(body.features)
        probability = _infer(model, features)

        span_context = span.get_span_context()
        trace_id = format(span_context.trace_id, "032x")
        span.set_attribute("ml.churn_probability", probability)

        return PredictResponse(
            subscription_id=body.subscription_id,
            churn_probability=probability,
            model_version=model["version"],
            trace_id=trace_id,
        )


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": SERVICE_NAME}
