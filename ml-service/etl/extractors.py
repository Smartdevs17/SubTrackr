"""Feature extraction from various data sources."""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, List, Optional


class BaseExtractor(ABC):
    """Base class for feature extractors."""

    @abstractmethod
    def extract(self, source_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract raw data from a source."""
        ...

    @abstractmethod
    def validate(self, data: List[Dict[str, Any]]) -> bool:
        """Validate extracted data."""
        ...


class SubscriptionExtractor(BaseExtractor):
    """Extract subscription features from subscription data."""

    def extract(self, source_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        subscriptions = source_config.get("subscriptions", [])
        features = []
        for sub in subscriptions:
            features.append({
                "subscriber": sub.get("subscriber", ""),
                "subscription_id": sub.get("id", ""),
                "plan_id": sub.get("plan_id", ""),
                "price": sub.get("price", 0),
                "currency": sub.get("currency", "USD"),
                "is_active": sub.get("isActive", True),
                "billing_cycle": sub.get("billingCycle", "monthly"),
                "days_since_start": self._days_since(sub.get("createdAt", datetime.now().isoformat())),
                "total_paid": sub.get("totalPaid", 0),
                "charge_count": sub.get("chargeCount", 0),
                "total_gas_spent": sub.get("totalGasSpent", 0),
            })
        return features

    def validate(self, data: List[Dict[str, Any]]) -> bool:
        return all("subscriber" in d and "price" in d for d in data)

    @staticmethod
    def _days_since(iso_date: str) -> int:
        try:
            created = datetime.fromisoformat(iso_date.replace("Z", "+00:00"))
            delta = datetime.now().astimezone() - created
            return delta.days
        except (ValueError, TypeError):
            return 0


class PaymentExtractor(BaseExtractor):
    """Extract payment features from billing data."""

    def extract(self, source_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        payments = source_config.get("payments", [])
        features = []
        for payment in payments:
            features.append({
                "subscriber": payment.get("subscriber", ""),
                "subscription_id": payment.get("subscription_id", ""),
                "amount": payment.get("amount", 0),
                "status": payment.get("status", "unknown"),
                "timestamp": payment.get("timestamp", datetime.now().isoformat()),
                "gas_cost": payment.get("gasCost", 0),
                "is_success": payment.get("status") == "success",
            })
        return features

    def validate(self, data: List[Dict[str, Any]]) -> bool:
        return all("subscriber" in d and "amount" in d for d in data)


class UsageExtractor(BaseExtractor):
    """Extract usage features from metering data."""

    def extract(self, source_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        usage_records = source_config.get("usage", [])
        features = []
        for record in usage_records:
            features.append({
                "subscriber": record.get("subscriber", ""),
                "subscription_id": record.get("subscription_id", ""),
                "metric": record.get("metric", ""),
                "current_usage": record.get("currentUsage", 0),
                "limit": record.get("limit", 0),
                "rollover_balance": record.get("rolloverBalance", 0),
                "utilization_rate": (
                    record.get("currentUsage", 0) / max(record.get("limit", 1), 1)
                ),
            })
        return features

    def validate(self, data: List[Dict[str, Any]]) -> bool:
        return all("subscriber" in d for d in data)


class ChurnSignalExtractor(BaseExtractor):
    """Extract churn risk signals from user behavior data."""

    def extract(self, source_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        signals = source_config.get("churn_signals", [])
        features = []
        for signal in signals:
            features.append({
                "subscriber": signal.get("subscriber", ""),
                "recent_payment_failures": signal.get("recentPaymentFailures", 0),
                "baseline_logins_per_month": signal.get("baselineLoginsPerMonth", 1),
                "recent_logins": signal.get("recentLogins", 0),
                "open_support_tickets": signal.get("openSupportTickets", 0),
                "login_frequency_drop": self._calc_login_drop(signal),
                "price_sensitivity_index": signal.get("priceSensitivityIndex", 0.5),
            })
        return features

    def validate(self, data: List[Dict[str, Any]]) -> bool:
        return all("subscriber" in d for d in data)

    @staticmethod
    def _calc_login_drop(signal: Dict[str, Any]) -> float:
        baseline = max(signal.get("baselineLoginsPerMonth", 1), 1)
        recent = signal.get("recentLogins", baseline)
        return max(0.0, (baseline - recent) / baseline)


EXTRACTORS = {
    "subscriptions": SubscriptionExtractor,
    "payments": PaymentExtractor,
    "usage": UsageExtractor,
    "churn_signals": ChurnSignalExtractor,
}
