"""FastAPI surface for the auto-renewal pre-flight.

Run standalone with::

    cd ml-service && uvicorn churn.api:app --port 8001

or mount ``churn.api.router`` in the main service. The router is kept in the
churn package so the policy, telemetry and HTTP contract version together.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .policy import PreflightAction, RenewalContext
from .predictor import ChurnFeaturesInput, ModelChurnPredictor
from .service import RenewalPreflightRequest, RenewalPreflightService

router = APIRouter(prefix="/v1/churn/renewal", tags=["churn"])

_default_service = RenewalPreflightService(ModelChurnPredictor())


def get_preflight_service() -> RenewalPreflightService:
    return _default_service


class ChurnFeaturesModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    recent_payment_failures: int = Field(0, alias="recentPaymentFailures", ge=0)
    baseline_logins_per_month: float = Field(10, alias="baselineLoginsPerMonth", gt=0)
    recent_logins: float = Field(10, alias="recentLogins", ge=0)
    open_support_tickets: int = Field(0, alias="openSupportTickets", ge=0)
    price_sensitivity_index: float = Field(0.5, alias="priceSensitivityIndex", ge=0, le=1)

    def to_domain(self) -> ChurnFeaturesInput:
        return ChurnFeaturesInput(
            recent_payment_failures=self.recent_payment_failures,
            baseline_logins_per_month=self.baseline_logins_per_month,
            recent_logins=self.recent_logins,
            open_support_tickets=self.open_support_tickets,
            price_sensitivity_index=self.price_sensitivity_index,
        )


class RenewalPreflightRequestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    subscription_id: str = Field(..., alias="subscriptionId", min_length=1)
    subscriber: str = Field(..., alias="subscriber", min_length=1)
    renewal_at: datetime = Field(..., alias="renewalAt")
    amount_minor: int = Field(..., alias="amountMinor", gt=0)
    currency: str = Field(..., alias="currency", min_length=3, max_length=3)
    attempt: int = Field(1, alias="attempt", ge=1)
    payment_method_available: bool = Field(True, alias="paymentMethodAvailable")
    payment_method_expired: bool = Field(False, alias="paymentMethodExpired")
    previous_decision: PreflightAction | None = Field(None, alias="previousDecision")
    features: ChurnFeaturesModel = Field(default_factory=ChurnFeaturesModel)

    @field_validator("currency")
    @classmethod
    def normalise_currency(cls, value: str) -> str:
        return value.upper()

    def to_domain(self) -> RenewalContext:
        return RenewalContext(
            subscription_id=self.subscription_id,
            subscriber=self.subscriber,
            renewal_at=self.renewal_at,
            amount_minor=self.amount_minor,
            currency=self.currency,
            attempt=self.attempt,
            payment_method_available=self.payment_method_available,
            payment_method_expired=self.payment_method_expired,
            previous_decision=self.previous_decision,
        )


class PreflightDecisionResponse(BaseModel):
    subscription_id: str
    subscriber: str
    action: PreflightAction
    reason: str
    risk_level: str
    churn_probability: float | None
    model_version: str
    idempotency_key: str
    evaluated_at: str
    retry_after_seconds: int | None = None
    recommended_action: str | None = None
    cache_hit: bool = False


@router.post("/preflight", response_model=PreflightDecisionResponse)
def evaluate_renewal_preflight(
    payload: RenewalPreflightRequestModel,
    service: RenewalPreflightService = Depends(get_preflight_service),
) -> dict[str, Any]:
    try:
        decision = service.evaluate(
            RenewalPreflightRequest(
                context=payload.to_domain(),
                features=payload.features.to_domain(),
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return decision.to_dict()


app = FastAPI(title="SubTrackr Renewal Pre-flight", version="1.0.0")
app.include_router(router)
