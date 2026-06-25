from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict

router = APIRouter(tags=['rate-limit-anomaly'])

class FeaturePayload(BaseModel):
    request_rate: float
    endpoint_distribution: Dict[str, float]
    time_of_day: int
    payload_size: float
    user_agent_entropy: float
    geographic_spread: float

@router.post('/score')
def score(payload: FeaturePayload):
    score = min(1.0, payload.request_rate / 100.0)

    if len(payload.endpoint_distribution) > 6:
        score += 0.1
    if payload.user_agent_entropy > 3:
        score += 0.1
    if payload.geographic_spread > 2:
        score += 0.1

    return {
        'score': min(score, 1.0),
        'threshold': 0.8,
        'model': 'isolation_forest_v1'
    }
