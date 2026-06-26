"""
Airflow integration for feature refresh jobs.

Drop this file into an Airflow DAGs folder and point FEATURE_PIPELINE_URL at the
deployed feature-pipeline service.
"""

import os
from datetime import datetime

try:
    import requests
    from airflow import DAG
    from airflow.operators.python import PythonOperator
except ImportError:  # Allows repo validation without Airflow installed.
    DAG = None
    PythonOperator = None
    requests = None


FEATURE_PIPELINE_URL = os.getenv("FEATURE_PIPELINE_URL", "http://feature-pipeline:8010")


def _post(path: str) -> None:
    response = requests.post(f"{FEATURE_PIPELINE_URL}{path}", timeout=30)
    response.raise_for_status()


if DAG is not None:
    with DAG(
        dag_id="subtrackr_feature_pipeline_hourly",
        start_date=datetime(2026, 1, 1),
        schedule="0 * * * *",
        catchup=False,
        tags=["subtrackr", "features"],
    ) as hourly_dag:
        PythonOperator(
            task_id="hourly_real_time_features",
            python_callable=lambda: _post("/v1/jobs/refresh/realtime"),
        )

    with DAG(
        dag_id="subtrackr_feature_pipeline_daily",
        start_date=datetime(2026, 1, 1),
        schedule="0 2 * * *",
        catchup=False,
        tags=["subtrackr", "features"],
    ) as daily_dag:
        PythonOperator(
            task_id="daily_historical_aggregates",
            python_callable=lambda: _post("/v1/jobs/refresh/historical"),
        )
