"""
SubTrackr ML Model Definitions

ChurnPredictionModel – wraps a scikit-learn GradientBoostingClassifier with a
heuristic fallback when sklearn is unavailable (e.g. cold-start / test envs).

RevenueForecastModel – linear trend extrapolation with exponential smoothing
and confidence intervals.
"""
from __future__ import annotations

import json
import logging
import math
import os
import pickle
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Optional ML dependencies ───────────────────────────────────────────────────
try:
    import numpy as np
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.calibration import CalibratedClassifierCV

    _SKLEARN_AVAILABLE = True
except ImportError:  # pragma: no cover
    _SKLEARN_AVAILABLE = False
    logger.warning(
        "scikit-learn / numpy not installed – falling back to heuristic churn model. "
        "Install ml-service/requirements-ml.txt for full functionality."
    )


# ══════════════════════════════════════════════════════════════════════════════
# Churn Prediction Model
# ══════════════════════════════════════════════════════════════════════════════

#: Default feature weights used by the heuristic fallback and as initial GBM
#: feature importance hints.
_DEFAULT_WEIGHTS: Dict[str, float] = {
    "payment_failures": 0.40,
    "login_frequency_drop": 0.25,
    "support_tickets": 0.15,
    "app_crashes": 0.10,
    "price_sensitivity": 0.10,
}

#: Canonical feature ordering used throughout training/inference
FEATURE_NAMES: List[str] = [
    "payment_failures",
    "login_frequency_drop",
    "support_tickets",
    "app_crashes",
    "price_sensitivity",
]

#: Risk thresholds
THRESHOLD_HIGH = 0.70
THRESHOLD_MEDIUM = 0.40


class ChurnPredictionModel:
    """
    ML-backed churn predictor.

    When scikit-learn is available and a trained model file exists the class
    delegates to a calibrated GradientBoostingClassifier.  Otherwise it uses
    a weighted-feature heuristic that is deterministic and requires no
    dependencies.
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        feature_weights: Optional[Dict[str, float]] = None,
    ) -> None:
        self.feature_weights: Dict[str, float] = feature_weights or dict(_DEFAULT_WEIGHTS)
        self._clf: Optional[Any] = None  # calibrated sklearn pipeline
        self._scaler: Optional[Any] = None

        if model_path and os.path.exists(model_path):
            self._load_sklearn_model(model_path)

    # ── sklearn model I/O ──────────────────────────────────────────────────────

    def _load_sklearn_model(self, path: str) -> None:
        try:
            with open(path, "rb") as fh:
                bundle = pickle.load(fh)
            self._clf = bundle["clf"]
            self._scaler = bundle.get("scaler")
            # Honour persisted feature importance as weights
            if hasattr(self._clf, "estimators_") or hasattr(self._clf, "calibrated_classifiers_"):
                logger.info("sklearn GBM model loaded from %s", path)
        except Exception as exc:
            logger.warning("Could not load sklearn model from %s: %s – using heuristic", path, exc)
            self._clf = None

    def save_sklearn_model(self, path: str) -> None:
        if self._clf is None:
            raise RuntimeError("No trained sklearn model to save")
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "wb") as fh:
            pickle.dump({"clf": self._clf, "scaler": self._scaler}, fh)
        logger.info("sklearn model saved to %s", path)

    # ── Training ───────────────────────────────────────────────────────────────

    def train(self, samples: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Fit a GradientBoostingClassifier on labelled feature samples.

        Each sample must contain the keys in ``FEATURE_NAMES`` plus a
        ``churned`` boolean label.

        Returns a metrics dict: ``{"samples": N, "feature_importances": {...}}``.
        """
        if not _SKLEARN_AVAILABLE:
            logger.warning("sklearn not available – skipping training, keeping heuristic weights")
            return {"samples": len(samples), "sklearn_available": False}

        if len(samples) < 10:
            raise ValueError(f"Need at least 10 training samples, got {len(samples)}")

        X, y = self._samples_to_arrays(samples)

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        base_clf = GradientBoostingClassifier(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            random_state=42,
        )
        clf = CalibratedClassifierCV(base_clf, cv=3, method="isotonic")
        clf.fit(X_scaled, y)

        self._clf = clf
        self._scaler = scaler

        # Extract feature importances and update weights for heuristic fallback
        try:
            raw_importance = base_clf.feature_importances_
            total = raw_importance.sum() or 1.0
            for i, name in enumerate(FEATURE_NAMES):
                self.feature_weights[name] = float(raw_importance[i] / total)
        except Exception:
            pass  # calibrated wrapper may hide raw clf

        return {
            "samples": len(samples),
            "sklearn_available": True,
            "feature_importances": self.feature_weights,
        }

    @staticmethod
    def _samples_to_arrays(samples: List[Dict]) -> Tuple[Any, Any]:
        import numpy as np  # type: ignore

        X = np.array(
            [[s.get(f, 0.0) for f in FEATURE_NAMES] for s in samples],
            dtype=np.float32,
        )
        y = np.array([int(bool(s.get("churned", False))) for s in samples], dtype=np.int32)
        return X, y

    # ── Inference ──────────────────────────────────────────────────────────────

    def predict_churn(self, subscriber_address: str, features: Dict[str, float]) -> Dict[str, Any]:
        """
        Returns a churn risk assessment for *subscriber_address*.

        ``features`` must be the normalised feature dict produced by
        ``services/feature-pipeline/features/churn.py::compute_features``.
        """
        churn_probability = self._score(features)
        risk_level = self._risk_level(churn_probability)
        risk_factors = self._top_factors(features)

        return {
            "subscriber": subscriber_address,
            "churn_probability": round(churn_probability, 4),
            "risk_level": risk_level,
            "risk_factors": risk_factors,
            "recommended_action": self._recommended_action(risk_level, risk_factors),
            "using_ml_model": self._clf is not None and _SKLEARN_AVAILABLE,
        }

    def _score(self, features: Dict[str, float]) -> float:
        if self._clf is not None and _SKLEARN_AVAILABLE:
            return self._sklearn_score(features)
        return self._heuristic_score(features)

    def _sklearn_score(self, features: Dict[str, float]) -> float:
        import numpy as np  # type: ignore

        x = np.array([[features.get(f, 0.0) for f in FEATURE_NAMES]], dtype=np.float32)
        if self._scaler is not None:
            x = self._scaler.transform(x)
        proba = self._clf.predict_proba(x)[0]
        # proba[1] = P(churn=1)
        return float(proba[1]) if len(proba) > 1 else float(proba[0])

    def _heuristic_score(self, features: Dict[str, float]) -> float:
        score = sum(
            features.get(name, 0.0) * weight
            for name, weight in self.feature_weights.items()
        )
        return min(max(score, 0.0), 1.0)

    @staticmethod
    def _risk_level(probability: float) -> str:
        if probability >= THRESHOLD_HIGH:
            return "High"
        if probability >= THRESHOLD_MEDIUM:
            return "Medium"
        return "Low"

    def _top_factors(self, features: Dict[str, float]) -> List[Dict[str, Any]]:
        weighted = [
            {"factor": name, "impact": round(features.get(name, 0.0) * w, 4)}
            for name, w in self.feature_weights.items()
            if features.get(name, 0.0) > 0.05
        ]
        return sorted(weighted, key=lambda x: x["impact"], reverse=True)[:5]

    @staticmethod
    def _recommended_action(risk_level: str, factors: List[Dict]) -> str:
        if risk_level == "Low":
            return "No action needed. Monitor normal activity."

        primary = factors[0]["factor"] if factors else ""
        actions = {
            "payment_failures": "Send payment method update reminder with a 5 % discount offer.",
            "login_frequency_drop": "Send re-engagement email highlighting new features.",
            "support_tickets": "Prioritise open support tickets for immediate resolution.",
            "app_crashes": "Reach out with technical support and offer service credit.",
            "price_sensitivity": "Offer a personalised discount or an annual plan upgrade.",
        }
        return actions.get(primary, "Offer a 1-month free extension to retain the subscriber.")


# ══════════════════════════════════════════════════════════════════════════════
# Revenue Forecast Model
# ══════════════════════════════════════════════════════════════════════════════


class RevenueForecastModel:
    """
    Linear trend extrapolation with exponential smoothing and Gaussian
    confidence intervals.

    Uses a Holt (double-exponential) smoothing approach when the series
    is long enough, otherwise falls back to simple linear delta averaging.
    """

    def __init__(self, alpha: float = 0.5, beta: float = 0.3) -> None:
        #: Smoothing factor for level
        self.alpha = alpha
        #: Smoothing factor for trend
        self.beta = beta

    def forecast(
        self, observations: List[Dict[str, Any]], horizon: int = 3
    ) -> List[Dict[str, Any]]:
        values = [float(item.get("revenue", 0)) for item in observations]
        if not values:
            return []

        if len(values) >= 4:
            return self._holt_forecast(values, observations, horizon)
        return self._linear_delta_forecast(values, observations, horizon)

    # ── Holt double-exponential smoothing ──────────────────────────────────────

    def _holt_forecast(
        self,
        values: List[float],
        observations: List[Dict],
        horizon: int,
    ) -> List[Dict[str, Any]]:
        # Initialise
        level = values[0]
        trend = (values[1] - values[0])

        smoothed: List[float] = []
        for v in values:
            prev_level = level
            level = self.alpha * v + (1 - self.alpha) * (level + trend)
            trend = self.beta * (level - prev_level) + (1 - self.beta) * trend
            smoothed.append(level)

        # Residuals for confidence interval
        residuals = [values[i] - smoothed[i] for i in range(len(values))]
        sigma = math.sqrt(sum(r ** 2 for r in residuals) / max(len(residuals), 1))

        forecast: List[Dict[str, Any]] = []
        for step in range(1, horizon + 1):
            expected = max(0.0, level + trend * step)
            ci_half = 1.96 * sigma * math.sqrt(step)
            forecast.append(
                {
                    "period": self._next_period(observations, step),
                    "expected_revenue": round(expected, 2),
                    "lower_bound": round(max(0.0, expected - ci_half), 2),
                    "upper_bound": round(expected + ci_half, 2),
                }
            )
        return forecast

    # ── Linear delta fallback ──────────────────────────────────────────────────

    def _linear_delta_forecast(
        self,
        values: List[float],
        observations: List[Dict],
        horizon: int,
    ) -> List[Dict[str, Any]]:
        latest = values[-1]
        deltas = [values[i] - values[i - 1] for i in range(1, len(values))]
        avg_delta = sum(deltas) / len(deltas) if deltas else 0.0
        variance = (
            sum((d - avg_delta) ** 2 for d in deltas) / len(deltas)
            if deltas
            else max(latest * 0.05, 1.0)
        )
        sigma = math.sqrt(variance)

        forecast: List[Dict[str, Any]] = []
        for step in range(1, horizon + 1):
            expected = max(0.0, latest + avg_delta * step)
            ci_half = 1.96 * sigma * math.sqrt(step)
            forecast.append(
                {
                    "period": self._next_period(observations, step),
                    "expected_revenue": round(expected, 2),
                    "lower_bound": round(max(0.0, expected - ci_half), 2),
                    "upper_bound": round(expected + ci_half, 2),
                }
            )
        return forecast

    @staticmethod
    def _next_period(observations: List[Dict], step: int) -> str:
        """Generate a period label following the last observed period."""
        if not observations:
            return f"forecast_{step}"
        last_period = observations[-1].get("period", "")
        # Try YYYY-MM pattern
        try:
            parts = last_period.split("-")
            if len(parts) == 2:
                year, month = int(parts[0]), int(parts[1])
                total_months = year * 12 + month + step - 1
                new_year, new_month = divmod(total_months, 12)
                new_month += 1
                return f"{new_year}-{new_month:02d}"
        except (ValueError, TypeError):
            pass
        return f"forecast_{step}"
