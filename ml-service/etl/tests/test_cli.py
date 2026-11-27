"""Tests for the standalone ETL command-line interface."""

import argparse
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

try:
    from etl.cli import build_config, main, serialise_result
    from etl.config import FeatureStoreType, PipelineSchedule
    from etl.pipeline import PipelineResult
except ModuleNotFoundError:
    from ml_service.etl.cli import build_config, main, serialise_result
    from ml_service.etl.config import FeatureStoreType, PipelineSchedule
    from ml_service.etl.pipeline import PipelineResult


def args(**overrides):
    values = {"config": None, "input": None, "output": None, "sources": None, "store": None}
    values.update(overrides)
    return argparse.Namespace(**values)


class TestCliConfig(unittest.TestCase):
    def test_environment_overrides(self):
        config = build_config(
            args(),
            {
                "SUBTRACKR_ETL_SOURCES": "subscriptions, payments",
                "SUBTRACKR_ETL_STORE": "redis",
                "SUBTRACKR_ETL_REDIS_URL": "redis://cache:6379",
            },
        )
        self.assertEqual(config.feature_sources, ["subscriptions", "payments"])
        self.assertEqual(config.feature_store.store_type, FeatureStoreType.REDIS)
        self.assertEqual(config.feature_store.connection_string, "redis://cache:6379")

    def test_json_config_and_cli_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "batch_size": 250,
                        "schedule": "hourly",
                        "feature_store": {"store_type": "bigquery", "project_id": "analytics"},
                    }
                ),
                encoding="utf-8",
            )
            config = build_config(args(config=str(path), store="inmemory"))
        self.assertEqual(config.batch_size, 250)
        self.assertEqual(config.schedule, PipelineSchedule.HOURLY)
        self.assertEqual(config.feature_store.project_id, "analytics")
        self.assertEqual(config.feature_store.store_type, FeatureStoreType.INMEMORY)

    def test_repeatable_source_flags(self):
        config = build_config(args(sources=["subscriptions", "usage"]))
        self.assertEqual(config.feature_sources, ["subscriptions", "usage"])


class TestCliExecution(unittest.TestCase):
    def test_run_writes_report(self):
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "input.json"
            output_path = Path(directory) / "report.json"
            input_path.write_text(
                json.dumps(
                    {
                        "subscriptions": [
                            {
                                "id": "sub_1",
                                "subscriber": "0xABC",
                                "price": 9.99,
                                "currency": "USD",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            code = main(["--input", str(input_path), "--output", str(output_path)])
            report = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(code, 0)
        self.assertTrue(report["success"])
        self.assertGreaterEqual(report["records_extracted"], 1)
        self.assertGreaterEqual(report["records_loaded"], 1)
        self.assertIn("duration_ms", report)

    def test_unknown_source_is_a_run_failure(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = main(["--source", "missing"])
        report = json.loads(stdout.getvalue())
        self.assertEqual(code, 1)
        self.assertFalse(report["success"])
        self.assertTrue(any("missing" in error for error in report["errors"]))

    def test_missing_config_file_is_a_usage_error(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code = main(["--config", "does-not-exist.json"])
        self.assertEqual(code, 2)
        self.assertIn("success", json.loads(stderr.getvalue()))

    def test_serialise_result_is_json_compatible(self):
        report = serialise_result(PipelineResult(success=True))
        self.assertEqual(json.loads(json.dumps(report)), report)


if __name__ == "__main__":
    unittest.main()
