"""Feature transformation pipeline stages."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BaseTransformer(ABC):
    """Base class for feature transformers."""

    @abstractmethod
    def transform(self, features: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Transform extracted features."""
        ...


class NormalizationTransformer(BaseTransformer):
    """Normalize numeric features to 0-1 range."""

    def __init__(self, columns: Optional[List[str]] = None):
        self.columns = columns

    def transform(self, features: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not features:
            return features

        columns = self.columns or [
            k for k, v in features[0].items() if isinstance(v, (int, float))
        ]

        for col in columns:
            values = [f.get(col, 0) for f in features if isinstance(f.get(col), (int, float))]
            if not values:
                continue
            min_val = min(values)
            max_val = max(values)
            range_val = max_val - min_val if max_val != min_val else 1.0

            for feature in features:
                if isinstance(feature.get(col), (int, float)):
                    feature[f"{col}_normalized"] = (feature[col] - min_val) / range_val

        return features


class AggregationTransformer(BaseTransformer):
    """Aggregate features by subscriber."""

    def __init__(self, group_by: str = "subscriber", aggregations: Optional[Dict[str, str]] = None):
        self.group_by = group_by
        self.aggregations = aggregations or {}

    def transform(self, features: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not features:
            return features

        groups: Dict[str, List[Dict[str, Any]]] = {}
        for feature in features:
            key = str(feature.get(self.group_by, "unknown"))
            groups.setdefault(key, []).append(feature)

        result = []
        for group_key, group_features in groups.items():
            aggregated = {self.group_by: group_key}
            for col, func in self.aggregations.items():
                values = [f.get(col, 0) for f in group_features if isinstance(f.get(col), (int, float))]
                if values:
                    if func == "sum":
                        aggregated[f"{col}_sum"] = sum(values)
                    elif func == "mean":
                        aggregated[f"{col}_mean"] = sum(values) / len(values)
                    elif func == "max":
                        aggregated[f"{col}_max"] = max(values)
                    elif func == "min":
                        aggregated[f"{col}_min"] = min(values)
                    elif func == "count":
                        aggregated[f"{col}_count"] = len(values)
            result.append(aggregated)

        return result


class FeatureDerivationTransformer(BaseTransformer):
    """Derive new features from existing ones."""

    def __init__(self, derivations: Optional[Dict[str, Any]] = None):
        self.derivations = derivations or {}

    def transform(self, features: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        for feature in features:
            for new_col, rule in self.derivations.items():
                source_col = rule.get("source", "")
                operation = rule.get("operation", "identity")
                factor = rule.get("factor", 1.0)

                value = feature.get(source_col, 0)
                if not isinstance(value, (int, float)):
                    continue

                if operation == "multiply":
                    feature[new_col] = value * factor
                elif operation == "add":
                    feature[new_col] = value + factor
                elif operation == "log":
                    import math
                    feature[new_col] = math.log1p(max(0, value))
                elif operation == "ratio":
                    denominator = feature.get(rule.get("denominator", ""), 1)
                    feature[new_col] = value / max(denominator, 1)
                elif operation == "bin":
                    thresholds = rule.get("thresholds", [0.33, 0.66])
                    if value < thresholds[0]:
                        feature[new_col] = "low"
                    elif value < thresholds[1]:
                        feature[new_col] = "medium"
                    else:
                        feature[new_col] = "high"
                else:
                    feature[new_col] = value

        return features


class DeduplicationTransformer(BaseTransformer):
    """Remove duplicate features based on a key."""

    def __init__(self, key: str = "subscriber"):
        self.key = key

    def transform(self, features: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen = set()
        result = []
        for feature in features:
            key_val = feature.get(self.key)
            if key_val not in seen:
                seen.add(key_val)
                result.append(feature)
        return result


TRANSFORMERS = {
    "normalization": NormalizationTransformer,
    "aggregation": AggregationTransformer,
    "derivation": FeatureDerivationTransformer,
    "deduplication": DeduplicationTransformer,
}
