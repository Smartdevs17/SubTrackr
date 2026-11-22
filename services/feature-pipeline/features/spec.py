"""Single source of truth for the churn feature set.

Every feature name, raw-input default and reference distribution lives here.
`churn.py` (computation, hashing, drift) and `main.py` (request schema) derive
from this module, so adding or changing a feature is a one-file edit.
"""
from dataclasses import dataclass
from typing import Dict, Tuple

FEATURE_SET_NAME = "churn"
TRANSFORMATION_VERSION = "2026-06-25.1"

# Raw user-data fields accepted by the pipeline, with their defaults.
RAW_INPUT_DEFAULTS: Dict[str, float] = {
    "recent_payment_failures": 0,
    "baseline_logins_per_month": 10,
    "recent_logins": 10,
    "open_support_tickets": 0,
    "app_crashes": 0,
    "price_sensitivity_index": 0.5,
}


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    reference: Tuple[float, ...]


FEATURES: Tuple[FeatureSpec, ...] = (
    FeatureSpec("payment_failures", (0.0, 0.0, 0.1, 0.25, 0.4, 0.75, 1.0)),
    FeatureSpec("login_frequency_drop", (0.0, 0.05, 0.1, 0.18, 0.3, 0.55, 0.8)),
    FeatureSpec("support_tickets", (0.0, 0.0, 0.1, 0.25, 0.5, 0.75, 1.0)),
    FeatureSpec("app_crashes", (0.0, 0.0, 0.02, 0.05, 0.08, 0.12, 0.2)),
    FeatureSpec("price_sensitivity", (0.1, 0.25, 0.4, 0.5, 0.65, 0.8, 0.95)),
)

FEATURE_NAMES: Tuple[str, ...] = tuple(f.name for f in FEATURES)
REFERENCE_DISTRIBUTION: Dict[str, list] = {f.name: list(f.reference) for f in FEATURES}
