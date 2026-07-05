"""Behavioral feature extraction for rate-limit anomaly detection (#615).

Mirrors backend/gateway/featureExtraction.ts. Turns a window of recent requests
into a fixed-length numeric feature vector.
"""

from __future__ import annotations

import math
from collections import Counter
from datetime import datetime, timezone
from typing import Dict, List

FEATURE_ORDER = [
    "request_rate",
    "endpoint_entropy",
    "time_of_day",
    "avg_payload_size",
    "user_agent_entropy",
    "geo_spread",
]


def _entropy(counts: List[int]) -> float:
    total = sum(counts)
    if total == 0:
        return 0.0
    h = 0.0
    for c in counts:
        if c == 0:
            continue
        p = c / total
        h -= p * math.log2(p)
    return h


def extract_features(window: List[dict]) -> Dict[str, float]:
    """`window` is a list of request samples with keys:
    timestamp_ms, endpoint, payload_size, user_agent, ip.
    """
    if not window:
        return {k: 0.0 for k in FEATURE_ORDER}

    timestamps = [r["timestamp_ms"] for r in window]
    span_sec = max((max(timestamps) - min(timestamps)) / 1000.0, 1.0)
    latest = datetime.fromtimestamp(max(timestamps) / 1000.0, tz=timezone.utc)
    seconds_into_day = latest.hour * 3600 + latest.minute * 60 + latest.second

    endpoint_counts = list(Counter(r["endpoint"] for r in window).values())
    ua_counts = list(Counter(r["user_agent"] for r in window).values())

    return {
        "request_rate": len(window) / span_sec,
        "endpoint_entropy": _entropy(endpoint_counts),
        "time_of_day": seconds_into_day / 86400.0,
        "avg_payload_size": sum(r["payload_size"] for r in window) / len(window),
        "user_agent_entropy": _entropy(ua_counts),
        "geo_spread": float(len({r["ip"] for r in window})),
    }


def to_vector(features: Dict[str, float]) -> List[float]:
    return [features[k] for k in FEATURE_ORDER]
