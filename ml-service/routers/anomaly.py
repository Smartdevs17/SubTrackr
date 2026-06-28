"""Rate-limit anomaly detection router (#615).

Exposes the Isolation Forest behavioral anomaly detector: train on normal
traffic windows, then score a window and get an adaptive rate-limit
recommendation. Mirrors backend/gateway so the gateway can either run scoring
locally or call this service.
"""

from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from anomaly.detector import AnomalyDetector, recommend_limit

router = APIRouter(tags=["anomaly"])

# Module-level model. A production deployment would persist/version this via the
# ModelRegistry and retrain on a schedule (see ml-service/retrain.py).
_detector = AnomalyDetector()


class RequestSample(BaseModel):
    timestamp_ms: int
    endpoint: str
    payload_size: int = 0
    user_agent: str = ""
    ip: str = ""


class TrainRequest(BaseModel):
    windows: List[List[RequestSample]] = Field(..., min_length=1)
    trees: int = 100
    sample_size: int = 256
    seed: int = 42


class ScoreRequest(BaseModel):
    window: List[RequestSample]
    base_limit: int = 100
    threshold: float = Field(0.8, ge=0.0, le=1.0)
    severe_threshold: float = Field(0.95, ge=0.0, le=1.0)


def _to_dicts(samples: List[RequestSample]) -> List[dict]:
    return [s.model_dump() for s in samples]


@router.post("/train")
def train(req: TrainRequest):
    global _detector
    _detector = AnomalyDetector(trees=req.trees, sample_size=req.sample_size, seed=req.seed)
    _detector.fit([_to_dicts(w) for w in req.windows])
    return {"trained": True, "windows": len(req.windows)}


@router.post("/score")
def score(req: ScoreRequest):
    if not _detector.fitted:
        raise HTTPException(status_code=409, detail="model not trained; POST /v1/anomaly/train first")
    result = _detector.score_window(_to_dicts(req.window))
    recommendation = recommend_limit(
        result.score, req.base_limit, req.threshold, req.severe_threshold
    )
    return {
        "score": result.score,
        "features": result.features,
        "recommendation": recommendation,
        "high_confidence": result.score >= 0.95,
    }


@router.get("/status")
def status() -> Dict[str, bool]:
    return {"fitted": _detector.fitted}
