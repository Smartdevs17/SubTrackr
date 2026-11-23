"""Command-line entry point for the standalone SubTrackr feature ETL.

The core engine has no third-party dependencies, so it can run as a cron job,
an Airflow task or a container without importing the API/backend packages.

Examples:
    python -m etl.cli --input snapshot.json --output result.json
    SUBTRACKR_ETL_STORE=redis SUBTRACKR_ETL_SOURCES=subscriptions,payments \
        subtrackr-etl --input snapshot.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Sequence

from .config import ETLConfig, FeatureStoreType, PipelineSchedule
from .pipeline import ETLPipeline, PipelineResult


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="subtrackr-etl", description=__doc__.splitlines()[0])
    parser.add_argument("--config", help="JSON file with ETLConfig overrides")
    parser.add_argument("--input", help="JSON file containing raw records keyed by source")
    parser.add_argument("--output", help="Write the JSON run report to this file instead of stdout")
    parser.add_argument("--source", action="append", dest="sources", help="Feature source to run (repeatable)")
    parser.add_argument("--store", help="Feature store backend: inmemory, redis or bigquery")
    return parser


def _read_json(path: Optional[str]) -> Dict[str, Any]:
    if not path:
        return {}
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def build_config(args: argparse.Namespace, environ: Optional[Dict[str, str]] = None) -> ETLConfig:
    """Build an ETLConfig from defaults, a JSON file, CLI flags and the environment."""
    env = environ if environ is not None else dict(os.environ)
    file_config = _read_json(args.config)
    store_config = file_config.get("feature_store") or {}

    sources = args.sources
    if not sources:
        sources = file_config.get("feature_sources") or env.get("SUBTRACKR_ETL_SOURCES")
    if isinstance(sources, str):
        sources = [item.strip() for item in sources.split(",") if item.strip()]

    config = ETLConfig()
    if sources:
        config.feature_sources = list(sources)
    if "batch_size" in file_config:
        config.batch_size = int(file_config["batch_size"])
    if "max_workers" in file_config:
        config.max_workers = int(file_config["max_workers"])
    if "schedule" in file_config:
        config.schedule = PipelineSchedule(str(file_config["schedule"]))

    store_type = args.store or store_config.get("store_type") or env.get("SUBTRACKR_ETL_STORE")
    if store_type:
        config.feature_store.store_type = FeatureStoreType(str(store_type).lower())
    config.feature_store.connection_string = store_config.get("connection_string") or env.get(
        "SUBTRACKR_ETL_REDIS_URL"
    )
    config.feature_store.project_id = store_config.get("project_id") or env.get(
        "SUBTRACKR_ETL_PROJECT_ID"
    )
    if store_config.get("dataset_id"):
        config.feature_store.dataset_id = str(store_config["dataset_id"])
    return config


def serialise_result(result: PipelineResult) -> Dict[str, Any]:
    return {
        "success": result.success,
        "records_extracted": result.records_extracted,
        "records_transformed": result.records_transformed,
        "records_loaded": result.records_loaded,
        "duration_ms": round(result.duration_ms, 3),
        "feature_sets_updated": result.feature_sets_updated,
        "errors": result.errors,
        "timestamp": result.timestamp,
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config = build_config(args)
        source_data = _read_json(args.input)
        result = ETLPipeline(config).run(source_data)
        report = serialise_result(result)
        payload = json.dumps(report, indent=2, sort_keys=True)
        if args.output:
            Path(args.output).write_text(payload + "\n", encoding="utf-8")
        else:
            print(payload)
        return 0 if result.success else 1
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"success": False, "errors": [str(error)]}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
