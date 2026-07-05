"""Dependency-free Isolation Forest for rate-limit anomaly scoring (#615).

Mirrors backend/gateway/isolationForest.ts so the ml-service and the gateway
agree on scoring semantics. Pure Python (stdlib only) — no numpy/sklearn — to
match the existing ml-service dependency set.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import List, Optional

Vector = List[float]


def _c_factor(n: int) -> float:
    """Average path length of an unsuccessful BST search over n points."""
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    harmonic = math.log(n - 1) + 0.5772156649  # Euler–Mascheroni
    return 2 * harmonic - (2 * (n - 1) / n)


@dataclass
class _Node:
    size: Optional[int] = None
    split_feature: Optional[int] = None
    split_value: Optional[float] = None
    left: Optional["_Node"] = None
    right: Optional["_Node"] = None


def _build_tree(data: List[Vector], height_limit: int, rng: random.Random, depth: int = 0) -> _Node:
    if depth >= height_limit or len(data) <= 1:
        return _Node(size=len(data))
    dims = len(data[0])
    feature = rng.randrange(dims)
    values = [row[feature] for row in data]
    lo, hi = min(values), max(values)
    if lo == hi:
        return _Node(size=len(data))
    split = lo + rng.random() * (hi - lo)
    left = [r for r in data if r[feature] < split]
    right = [r for r in data if r[feature] >= split]
    return _Node(
        split_feature=feature,
        split_value=split,
        left=_build_tree(left, height_limit, rng, depth + 1),
        right=_build_tree(right, height_limit, rng, depth + 1),
    )


def _path_length(point: Vector, node: _Node, depth: int = 0) -> float:
    if node.size is not None:
        return depth + _c_factor(node.size)
    assert node.split_feature is not None and node.split_value is not None
    nxt = node.left if point[node.split_feature] < node.split_value else node.right
    assert nxt is not None
    return _path_length(point, nxt, depth + 1)


@dataclass
class IsolationForest:
    trees: int = 100
    sample_size: int = 256
    seed: int = 42
    _forest: List[_Node] = field(default_factory=list)
    _norm: float = 1.0

    def fit(self, data: List[Vector]) -> "IsolationForest":
        if not data:
            raise ValueError("cannot fit on empty data")
        rng = random.Random(self.seed)
        sample_size = min(self.sample_size, len(data))
        height_limit = math.ceil(math.log2(max(2, sample_size)))
        self._norm = _c_factor(sample_size) or 1.0
        self._forest = []
        for _ in range(self.trees):
            sample = [data[rng.randrange(len(data))] for _ in range(sample_size)]
            self._forest.append(_build_tree(sample, height_limit, rng))
        return self

    def score(self, point: Vector) -> float:
        """Anomaly score in [0, 1]; higher = more anomalous."""
        if not self._forest:
            raise RuntimeError("forest not fitted")
        avg = sum(_path_length(point, t) for t in self._forest) / len(self._forest)
        return 2 ** (-avg / self._norm)
