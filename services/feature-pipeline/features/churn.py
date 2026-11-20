import hashlib
import inspect
import json
from typing import Dict, Iterable, List

from .spec import FEATURE_SET_NAME, RAW_INPUT_DEFAULTS, REFERENCE_DISTRIBUTION, TRANSFORMATION_VERSION


def _bounded(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(float(value), upper))


def compute_features(user_data: Dict) -> Dict[str, float]:
    raw = {**RAW_INPUT_DEFAULTS, **user_data}
    baseline_logins = max(float(raw["baseline_logins_per_month"]), 1.0)
    recent_logins = float(user_data.get("recent_logins", baseline_logins))
    login_drop = max(0.0, (baseline_logins - recent_logins) / baseline_logins)

    return {
        "payment_failures": _bounded(float(raw["recent_payment_failures"]) / 3.0),
        "login_frequency_drop": _bounded(login_drop),
        "support_tickets": _bounded(float(raw["open_support_tickets"]) / 2.0),
        "app_crashes": _bounded(float(raw["app_crashes"]) / 10.0),
        "price_sensitivity": _bounded(float(raw["price_sensitivity_index"])),
    }


def feature_set_hash() -> str:
    payload = {
        "feature_set": FEATURE_SET_NAME,
        "version": TRANSFORMATION_VERSION,
        "source": inspect.getsource(compute_features),
        "reference_distribution": REFERENCE_DISTRIBUTION,
    }
    encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def kolmogorov_smirnov(current: Iterable[float], reference: Iterable[float]) -> Dict[str, float]:
    current_values = sorted(float(value) for value in current)
    reference_values = sorted(float(value) for value in reference)
    if not current_values or not reference_values:
        return {"statistic": 0.0, "p_value": 1.0}

    all_values = sorted(set(current_values + reference_values))
    n_current = len(current_values)
    n_reference = len(reference_values)
    max_delta = 0.0
    current_index = 0
    reference_index = 0

    for value in all_values:
        while current_index < n_current and current_values[current_index] <= value:
            current_index += 1
        while reference_index < n_reference and reference_values[reference_index] <= value:
            reference_index += 1
        max_delta = max(max_delta, abs((current_index / n_current) - (reference_index / n_reference)))

    effective_n = (n_current * n_reference) / (n_current + n_reference)
    p_value = min(1.0, max(0.0, 2.0 * pow(2.718281828459045, -2.0 * effective_n * max_delta * max_delta)))
    return {"statistic": round(max_delta, 6), "p_value": round(p_value, 6)}


def drift_report(current_rows: List[Dict[str, float]], alpha: float = 0.05) -> Dict:
    reports = {}
    drifted = False
    for feature_name, reference in REFERENCE_DISTRIBUTION.items():
        current = [row[feature_name] for row in current_rows if feature_name in row]
        result = kolmogorov_smirnov(current, reference)
        result["drift_detected"] = result["p_value"] < alpha
        drifted = drifted or result["drift_detected"]
        reports[feature_name] = result
    return {
        "feature_set": FEATURE_SET_NAME,
        "transform_hash": feature_set_hash(),
        "alpha": alpha,
        "drift_detected": drifted,
        "features": reports,
    }
