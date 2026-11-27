"""Unit tests for ml-service/app/usage/floor.py (issue #2251)."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

# Allow running this file directly from any working directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.usage.floor import (  # noqa: E402
    DEFAULT_USAGE_FLOOR_CONFIG,
    UsageFloorError,
    UsageSignal,
    below_floor,
    build_usage_signal,
    validate_usage_floor_config,
)

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)


def samples(units: list[float]) -> list[dict[str, object]]:
    base = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
    return [
        {"at": (base.replace(tzinfo=timezone.utc) + __import__("datetime").timedelta(days=i)).isoformat().replace("+00:00", "Z"), "units": u}
        for i, u in enumerate(units)
    ]


class ConfigTests(unittest.TestCase):
    def test_defaults_and_frozen(self) -> None:
        cfg = validate_usage_floor_config()
        self.assertEqual(cfg.usage_floor, DEFAULT_USAGE_FLOOR_CONFIG.usage_floor)
        with self.assertRaises(Exception):
            cfg.window_days = 1  # type: ignore[misc]

    def test_rejects_invalid_config(self) -> None:
        for bad in ({"usage_floor": -1}, {"window_days": 0}, {"window_days": 500}, {"min_samples": 40}):
            with self.subTest(bad=bad), self.assertRaises(UsageFloorError) as ctx:
                validate_usage_floor_config(bad)
            self.assertEqual(ctx.exception.code, "INVALID_CONFIG")


class SignalTests(unittest.TestCase):
    def test_summary_happy_path(self) -> None:
        signal = build_usage_signal(samples([2, 2, 2, 2]), {"usage_floor": 1}, NOW)
        self.assertIsInstance(signal, UsageSignal)
        self.assertEqual(signal.sample_count, 4)
        self.assertEqual(signal.total, 8.0)
        self.assertEqual(signal.average, 2.0)
        self.assertFalse(signal.below_floor)

    def test_below_floor_and_insufficient_samples(self) -> None:
        low = build_usage_signal(samples([0] * 7), {"usage_floor": 1}, NOW)
        self.assertTrue(low.below_floor)
        self.assertTrue(below_floor(low))
        thin = build_usage_signal(samples([0, 0]), {"usage_floor": 1}, NOW)
        self.assertTrue(thin.below_floor)
        self.assertFalse(below_floor(thin))

    def test_out_of_window_samples_ignored(self) -> None:
        old = [{"at": "2020-01-01T00:00:00Z", "units": 100}]
        signal = build_usage_signal(old, {}, NOW)
        self.assertEqual(signal.sample_count, 0)
        self.assertFalse(signal.below_floor)

    def test_malformed_samples_rejected(self) -> None:
        with self.assertRaises(UsageFloorError) as ctx:
            build_usage_signal([{"at": "2026-11-20T00:00:00Z", "units": -1}], {}, NOW)
        self.assertEqual(ctx.exception.code, "INVALID_SAMPLE")
        with self.assertRaises(UsageFloorError) as ctx:
            build_usage_signal([{"at": "not-a-date", "units": 1}], {}, NOW)
        self.assertEqual(ctx.exception.code, "INVALID_DATE")

    def test_non_iterable_rejected(self) -> None:
        with self.assertRaises(UsageFloorError) as ctx:
            build_usage_signal("nope", {}, NOW)  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.code, "INVALID_SAMPLE")


if __name__ == "__main__":
    unittest.main()
