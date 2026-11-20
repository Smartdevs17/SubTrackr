"""Typed Python client for the SubTrackr ML inference API."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class InferenceClientError(RuntimeError):
    """Base error raised by :class:`InferenceClient`."""


class InferenceAPIError(InferenceClientError):
    """The server rejected a request or returned an invalid response."""

    def __init__(self, status_code: int, message: str, correlation_id: str | None = None):
        self.status_code = status_code
        self.correlation_id = correlation_id
        super().__init__(f"ML service returned HTTP {status_code}: {message}")


class InferenceTransportError(InferenceClientError):
    """The service could not be reached or its response could not be decoded."""


@dataclass(frozen=True)
class ChurnFeatures:
    recent_payment_failures: float
    baseline_logins_per_month: float
    recent_logins: float
    open_support_tickets: float
    price_sensitivity_index: float

    def to_dict(self) -> dict[str, float]:
        return {
            "recent_payment_failures": self.recent_payment_failures,
            "baseline_logins_per_month": self.baseline_logins_per_month,
            "recent_logins": self.recent_logins,
            "open_support_tickets": self.open_support_tickets,
            "price_sensitivity_index": self.price_sensitivity_index,
        }


@dataclass(frozen=True)
class ChurnPrediction:
    subscriber: str
    churn_probability: float
    risk_level: str
    risk_factors: tuple[Mapping[str, Any], ...]
    recommended_action: str
    model_version: str

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "ChurnPrediction":
        try:
            probability = float(data["churn_probability"])
            if not 0 <= probability <= 1:
                raise ValueError("churn_probability must be between 0 and 1")
            risk_factors = data.get("risk_factors", [])
            if not isinstance(risk_factors, list):
                raise ValueError("risk_factors must be a list")
            return cls(
                subscriber=str(data["subscriber"]),
                churn_probability=probability,
                risk_level=str(data["risk_level"]),
                risk_factors=tuple(risk_factors),
                recommended_action=str(data["recommended_action"]),
                model_version=str(data["model_version"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise InferenceTransportError(f"Invalid churn prediction response: {exc}") from exc


@dataclass(frozen=True)
class BatchChurnResult:
    model_version: str
    results: tuple[ChurnPrediction | Mapping[str, Any], ...]


@dataclass(frozen=True)
class RevenueObservation:
    period: str
    revenue: float


@dataclass(frozen=True)
class RevenueForecast:
    period: str
    expected_revenue: float
    lower_bound: float
    upper_bound: float


class InferenceClient:
    """Synchronous, dependency-free client for the versioned inference API."""

    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        *,
        api_key: str | None = None,
        timeout: float = 5.0,
    ) -> None:
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def predict_churn(
        self, subscriber: str, user_data: ChurnFeatures, *, correlation_id: str | None = None
    ) -> ChurnPrediction:
        data = self._post(
            "/v1/churn/predict",
            {"subscriber": subscriber, "user_data": user_data.to_dict()},
            correlation_id,
        )
        return ChurnPrediction.from_dict(data)

    def predict_churn_batch(
        self,
        items: Sequence[tuple[str, ChurnFeatures]],
        *,
        correlation_id: str | None = None,
    ) -> BatchChurnResult:
        if not 1 <= len(items) <= 500:
            raise ValueError("batch must contain between 1 and 500 items")
        data = self._post(
            "/v1/churn/predict/batch",
            {"items": [{"subscriber": subscriber, "user_data": features.to_dict()}
                       for subscriber, features in items]},
            correlation_id,
        )
        try:
            parsed = []
            for item in data["results"]:
                if item.get("ok", True):
                    parsed.append(ChurnPrediction.from_dict(item))
                else:
                    parsed.append(item)
            return BatchChurnResult(str(data["model_version"]), tuple(parsed))
        except (KeyError, TypeError, AttributeError) as exc:
            raise InferenceTransportError(f"Invalid batch response: {exc}") from exc

    def forecast_revenue(
        self,
        observations: Sequence[RevenueObservation],
        horizon: int = 3,
        *,
        correlation_id: str | None = None,
    ) -> tuple[RevenueForecast, ...]:
        if len(observations) < 2:
            raise ValueError("at least two observations are required")
        if not 1 <= horizon <= 24:
            raise ValueError("horizon must be between 1 and 24")
        data = self._post(
            "/v1/churn/forecast",
            {"observations": [{"period": o.period, "revenue": o.revenue} for o in observations],
             "horizon": horizon},
            correlation_id,
        )
        try:
            return tuple(RevenueForecast(**row) for row in data)
        except (TypeError, ValueError) as exc:
            raise InferenceTransportError(f"Invalid forecast response: {exc}") from exc

    def health(self) -> Mapping[str, Any]:
        return self._request("GET", "/healthz")

    def _post(self, path: str, payload: Mapping[str, Any], correlation_id: str | None):
        return self._request("POST", path, payload, correlation_id)

    def _request(
        self, method: str, path: str, payload: Mapping[str, Any] | None = None,
        correlation_id: str | None = None,
    ):
        headers = {"Accept": "application/json", "X-Correlation-ID": correlation_id or str(uuid.uuid4())}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        body = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode("utf-8")
        request = Request(self.base_url + path, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except HTTPError as exc:
            try:
                error_data = json.loads(exc.read().decode("utf-8"))
                message = str(error_data.get("detail", error_data))
            except (ValueError, UnicodeDecodeError):
                message = exc.reason or "request failed"
            raise InferenceAPIError(
                exc.code, message, exc.headers.get("X-Correlation-ID") if exc.headers else None
            ) from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise InferenceTransportError(f"Could not reach ML service: {exc}") from exc
        try:
            decoded = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise InferenceTransportError("ML service returned invalid JSON") from exc
        if not isinstance(decoded, (dict, list)):
            raise InferenceTransportError("ML service returned an unexpected JSON value")
        return decoded
