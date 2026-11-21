"""Forecast response shaping for the billing dashboard."""

from typing import Any, Dict, List

from models import RevenueForecastModel


def build_dashboard_forecast(observations: List[Dict[str, Any]], horizon: int) -> Dict[str, Any]:
    return {
        "model_version": "revenue-v1",
        "forecast": RevenueForecastModel().forecast(observations, horizon),
    }


__all__ = ["build_dashboard_forecast"]
