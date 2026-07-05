from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(tags=["recommendations"])


class UserProfile(BaseModel):
    interests: List[str] = []


class RecommendationContext(BaseModel):
    active_subscriptions: List[str] = []
    user_profile: UserProfile = UserProfile()


class RecommendationRequest(BaseModel):
    subscriber: str
    context: Optional[RecommendationContext] = None


class BatchRecommendationRequest(BaseModel):
    items: List[RecommendationRequest]


class FeedbackRequest(BaseModel):
    subscriber: str
    recommendation_id: str
    accepted: bool


@router.post("/predict")
def get_recommendations(req: RecommendationRequest):
    from main import registry
    try:
        model = registry.get("recommendations")
        meta = registry.meta("recommendations")
        ctx = req.context.model_dump() if req.context else {}
        result = model.get_recommendations(req.subscriber, ctx)
        meta.record_prediction()
        return {"model_version": meta.version, "recommendations": result}
    except Exception as e:
        registry.meta("recommendations").record_error()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/predict/batch")
def get_recommendations_batch(req: BatchRecommendationRequest):
    from main import registry
    model = registry.get("recommendations")
    meta = registry.meta("recommendations")
    results = []
    for item in req.items:
        try:
            ctx = item.context.model_dump() if item.context else {}
            recs = model.get_recommendations(item.subscriber, ctx)
            meta.record_prediction()
            results.append({"ok": True, "subscriber": item.subscriber, "recommendations": recs})
        except Exception as e:
            meta.record_error()
            results.append({"ok": False, "subscriber": item.subscriber, "error": str(e)})
    return {"model_version": meta.version, "results": results}


@router.post("/feedback")
def record_feedback(req: FeedbackRequest):
    """Record whether a recommendation was accepted — used for accuracy tracking and A/B testing."""
    from main import registry
    meta = registry.meta("recommendations")
    meta.record_accuracy(req.accepted)
    return {
        "recorded": True,
        "drift_detected": meta.drift_detected,
        "recent_accuracy": meta.recent_accuracy,
    }
