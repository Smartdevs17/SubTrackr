"""Anomaly detector: feature extraction + Isolation Forest scoring (#615)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from .features import extract_features, to_vector
from .isolation_forest import IsolationForest


@dataclass
class AnomalyResult:
    score: float
    features: Dict[str, float]


class AnomalyDetector:
    def __init__(self, trees: int = 100, sample_size: int = 256, seed: int = 42) -> None:
        self._forest = IsolationForest(trees=trees, sample_size=sample_size, seed=seed)
        self._fitted = False

    @property
    def fitted(self) -> bool:
        return self._fitted

    def fit(self, normal_windows: List[List[dict]]) -> "AnomalyDetector":
        vectors = [to_vector(extract_features(w)) for w in normal_windows]
        self._forest.fit(vectors)
        self._fitted = True
        return self

    def score_window(self, window: List[dict]) -> AnomalyResult:
        feats = extract_features(window)
        return AnomalyResult(score=self._forest.score(to_vector(feats)), features=feats)


def recommend_limit(score: float, base_limit: int, threshold: float = 0.8,
                    severe: float = 0.95) -> dict:
    """Adaptive limit recommendation mirroring the gateway's decision logic."""
    if score >= severe:
        return {"action": "severely-reduced", "effective_limit": base_limit // 10, "severity": "high"}
    if score >= threshold:
        return {"action": "reduced", "effective_limit": base_limit // 2, "severity": "medium"}
    return {"action": "normal", "effective_limit": base_limit, "severity": "low"}
