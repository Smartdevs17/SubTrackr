from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

router = APIRouter(tags=["pricing"])


class UsageData(BaseModel):
    current_price: float = 10.0
    retention_rate: float = 0.5
    sessions_per_week: float = 2.0


class PricingContext(BaseModel):
    current_price: float = 10.0
    competitor_avg: Optional[float] = None
    current_demand: float = 1.0
    usage_data: UsageData = UsageData()
    price_floor: Optional[float] = None
    price_ceiling: Optional[float] = None


class PricingRequest(BaseModel):
    subscription_id: str
    context: PricingContext


class ABTestRequest(BaseModel):
    plan_id: str
    historical_data: List[Dict[str, Any]]


@router.post("/optimize")
def optimize_price(req: PricingRequest, explain: bool = False):
    from main import registry
    try:
        model = registry.get("pricing")
        meta = registry.meta("pricing")
        ctx = req.context.model_dump()
        if ctx["competitor_avg"] is None:
            ctx["competitor_avg"] = ctx["current_price"]
        if ctx["price_floor"] is None:
            ctx["price_floor"] = ctx["current_price"] * 0.8
        if ctx["price_ceiling"] is None:
            ctx["price_ceiling"] = ctx["current_price"] * 1.5
        result = model.calculate_optimal_price(req.subscription_id, ctx)
        meta.record_prediction()
        if explain:
            try:
                expl = model.explain_price(ctx)
            except Exception:
                expl = {"error": "explanation_failed"}
            try:
                registry.record_explanation("pricing", req.subscription_id, ctx, expl.get("attributions", {}), segment=None)
            except Exception:
                pass
            return {"model_version": meta.version, **result, "explanation": expl}
        return {"model_version": meta.version, **result}
    except Exception as e:
        registry.meta("pricing").record_error()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ab-test")
def get_ab_test_tiers(req: ABTestRequest):
    """Returns Conservative / Balanced / Aggressive price tiers for A/B testing."""
    from main import registry
    try:
        model = registry.get("pricing")
        return model.get_price_recommendations(req.plan_id, req.historical_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
