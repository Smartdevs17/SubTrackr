import os
import sys
import unittest


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from features.churn import compute_features, drift_report, feature_set_hash
from features.spec import FEATURE_NAMES, RAW_INPUT_DEFAULTS, REFERENCE_DISTRIBUTION


class ChurnFeatureTests(unittest.TestCase):
    def test_compute_features_is_bounded_and_deterministic(self):
        raw = {
            "recent_payment_failures": 6,
            "baseline_logins_per_month": 20,
            "recent_logins": 5,
            "open_support_tickets": 3,
            "app_crashes": 2,
            "price_sensitivity_index": 1.4,
        }

        first = compute_features(raw)
        second = compute_features(raw)

        self.assertEqual(first, second)
        self.assertEqual(first["payment_failures"], 1.0)
        self.assertEqual(first["support_tickets"], 1.0)
        self.assertEqual(first["price_sensitivity"], 1.0)
        self.assertEqual(first["login_frequency_drop"], 0.75)

    def test_feature_hash_and_drift_report(self):
        transform_hash = feature_set_hash()
        report = drift_report([compute_features({"recent_payment_failures": 0})])

        self.assertEqual(len(transform_hash), 16)
        self.assertEqual(report["feature_set"], "churn")
        self.assertIn("payment_failures", report["features"])

    def test_spec_is_single_source_for_feature_names(self):
        self.assertEqual(set(compute_features({})), set(FEATURE_NAMES))
        self.assertEqual(set(REFERENCE_DISTRIBUTION), set(FEATURE_NAMES))

    def test_empty_input_uses_spec_defaults_and_stays_bounded(self):
        from_defaults = compute_features(dict(RAW_INPUT_DEFAULTS))
        self.assertEqual(compute_features({}), from_defaults)
        self.assertEqual(from_defaults["login_frequency_drop"], 0.0)
        for value in from_defaults.values():
            self.assertTrue(0.0 <= value <= 1.0)

    def test_reference_distributions_are_sorted_and_bounded(self):
        for name, values in REFERENCE_DISTRIBUTION.items():
            self.assertEqual(values, sorted(values), name)
            self.assertTrue(all(0.0 <= v <= 1.0 for v in values), name)


if __name__ == "__main__":
    unittest.main()
