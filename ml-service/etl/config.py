"""ETL pipeline configuration."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class FeatureStoreType(Enum):
    """Supported feature store backends."""
    BIGQUERY = "bigquery"
    SNOWFLAKE = "snowflake"
    REDIS = "redis"
    INMEMORY = "inmemory"


class PipelineSchedule(Enum):
    """Pipeline execution schedule."""
    REALTIME = "realtime"
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"


@dataclass
class FeatureStoreConfig:
    """Configuration for feature store connection."""
    store_type: FeatureStoreType = FeatureStoreType.INMEMORY
    connection_string: Optional[str] = None
    project_id: Optional[str] = None
    dataset_id: str = "subtrackr_features"
    table_prefix: str = "features_"
    ttl_seconds: int = 86400  # 24 hours default


@dataclass
class MonitoringConfig:
    """Configuration for ETL monitoring."""
    enabled: bool = True
    alert_threshold_ms: float = 5000.0  # Alert if pipeline takes > 5s
    error_rate_threshold: float = 0.05  # Alert if error rate > 5%
    log_level: str = "INFO"
    metrics_retention_days: int = 30


@dataclass
class ETLConfig:
    """Main ETL pipeline configuration."""
    # Feature extraction
    feature_sources: List[str] = field(default_factory=lambda: [
        "subscriptions", "payments", "usage", "churn_signals"
    ])
    batch_size: int = 1000
    max_workers: int = 4

    # Feature store
    feature_store: FeatureStoreConfig = field(default_factory=FeatureStoreConfig)

    # Pipeline orchestration
    schedule: PipelineSchedule = PipelineSchedule.DAILY
    retry_count: int = 3
    retry_delay_seconds: int = 60
    timeout_seconds: int = 3600

    # Monitoring
    monitoring: MonitoringConfig = field(default_factory=MonitoringConfig)

    # Feature definitions
    feature_definitions: Dict[str, dict] = field(default_factory=lambda: {
        "churn_risk_score": {
            "source": "churn_signals",
            "type": "float",
            "description": "Computed churn risk score (0.0-1.0)",
        },
        "monthly_spend": {
            "source": "subscriptions",
            "type": "float",
            "description": "Total monthly subscription spend",
        },
        "subscription_count": {
            "source": "subscriptions",
            "type": "integer",
            "description": "Number of active subscriptions",
        },
        "payment_failure_rate": {
            "source": "payments",
            "type": "float",
            "description": "Rate of payment failures",
        },
        "usage_intensity": {
            "source": "usage",
            "type": "float",
            "description": "Usage intensity score (0.0-1.0)",
        },
    })
