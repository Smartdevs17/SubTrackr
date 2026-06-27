"""Tests for the rate-limit anomaly detector (#615)."""

import random

from anomaly.detector import AnomalyDetector, recommend_limit
from anomaly.features import extract_features, to_vector
from anomaly.isolation_forest import IsolationForest


def _normal_window(w: int):
    n = 40 + (w % 20)
    base = 1_700_000_000_000 + w * 60_000
    endpoints = ["/api/subs", "/api/usage"] if w % 2 else ["/api/subs"]
    return [
        {
            "timestamp_ms": base + int(i * 60_000 / n),
            "endpoint": endpoints[i % len(endpoints)],
            "payload_size": 350 + (i % 100),
            "user_agent": "app/1",
            "ip": "10.0.0.1",
        }
        for i in range(n)
    ]


def _attack_window():
    return [
        {
            "timestamp_ms": 1_700_000_000_000 + i,
            "endpoint": f"/api/ep{i % 50}",
            "payload_size": 50_000,
            "user_agent": f"bot/{i % 100}",
            "ip": f"192.168.{i % 255}.{i % 255}",
        }
        for i in range(5000)
    ]


def test_features_shape_and_entropy():
    feats = extract_features(_normal_window(1))
    assert len(to_vector(feats)) == 6
    assert feats["geo_spread"] == 1.0
    # two endpoints -> positive entropy on odd window
    assert feats["endpoint_entropy"] > 0


def test_features_empty_window():
    assert extract_features([])["request_rate"] == 0.0


def test_isolation_forest_outlier_scores_higher():
    rng = random.Random(0)
    data = [[1 + rng.random(), 2 + rng.random(), rng.random(), 500 + rng.random() * 50] for _ in range(200)]
    forest = IsolationForest(trees=100, sample_size=128, seed=7).fit(data)
    inlier = forest.score([1.5, 2.5, 0.5, 525])
    outlier = forest.score([100, 90, 9, 90_000])
    assert outlier > inlier
    assert 0.0 <= inlier <= 1.0 and 0.0 <= outlier <= 1.0


def test_isolation_forest_deterministic():
    data = [[float(i % 7), float(i % 3)] for i in range(100)]
    a = IsolationForest(seed=1).fit(data).score([3.0, 1.0])
    b = IsolationForest(seed=1).fit(data).score([3.0, 1.0])
    assert a == b


def test_detector_flags_attack_over_normal():
    det = AnomalyDetector(seed=3).fit([_normal_window(w) for w in range(60)])
    normal = det.score_window(_normal_window(3)).score
    attack = det.score_window(_attack_window()).score
    assert attack > normal


def test_recommend_limit_thresholds():
    assert recommend_limit(0.3, 100)["action"] == "normal"
    assert recommend_limit(0.85, 100) == {"action": "reduced", "effective_limit": 50, "severity": "medium"}
    assert recommend_limit(0.97, 100) == {"action": "severely-reduced", "effective_limit": 10, "severity": "high"}
