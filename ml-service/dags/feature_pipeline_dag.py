"""Airflow DAG for SubTrackr ML feature pipeline orchestration.

Schedules and manages the ETL pipeline execution for feature engineering.
"""

from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator


default_args = {
    "owner": "subtrackr-ml",
    "depends_on_past": False,
    "email_on_failure": True,
    "email_on_retry": False,
    "retries": 3,
    "retry_delay": timedelta(minutes=5),
    "execution_timeout": timedelta(hours=1),
}


def extract_features(**context):
    from ml_service.etl.extractors import EXTRACTORS
    from ml_service.etl.config import ETLConfig

    config = ETLConfig()
    features = []
    for source_name in config.feature_sources:
        if source_name in EXTRACTORS:
            extractor = EXTRACTORS[source_name]()
            raw = extractor.extract({source_name: []})
            features.extend(raw)
    context["ti"].xcom_push(key="extracted_count", value=len(features))
    return features


def transform_features(**context):
    from ml_service.etl.transformers import NormalizationTransformer, FeatureDerivationTransformer

    features = context["ti"].xcom_pull(key="return_value", task_ids="extract")
    if not features:
        return []

    normalizer = NormalizationTransformer()
    features = normalizer.transform(features)

    deriver = FeatureDerivationTransformer(derivations={
        "risk_score_bin": {"source": "churn_probability", "operation": "bin", "thresholds": [0.33, 0.66]}
    })
    features = deriver.transform(features)
    context["ti"].xcom_push(key="transformed_count", value=len(features))
    return features


def load_features(**context):
    from ml_service.etl.loaders import InMemoryFeatureStore

    features = context["ti"].xcom_pull(key="return_value", task_ids="transform")
    if not features:
        return 0

    store = InMemoryFeatureStore()
    loaded = store.write_features("daily_features", features)
    context["ti"].xcom_push(key="loaded_count", value=loaded)
    return loaded


with DAG(
    "subtrackr_feature_pipeline",
    default_args=default_args,
    description="Daily ML feature extraction pipeline for SubTrackr",
    schedule_interval="@daily",
    start_date=datetime(2025, 1, 1),
    catchup=False,
    tags=["subtrackr", "ml", "features", "etl"],
) as dag:

    extract = PythonOperator(
        task_id="extract",
        python_callable=extract_features,
        doc="Extract features from subscription, payment, and usage data sources.",
    )

    transform = PythonOperator(
        task_id="transform",
        python_callable=transform_features,
        doc="Apply normalization and feature derivation transformations.",
    )

    load = PythonOperator(
        task_id="load",
        python_callable=load_features,
        doc="Load transformed features into the feature store.",
    )

    extract >> transform >> load
