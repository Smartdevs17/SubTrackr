import os
import sys
import unittest


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from features.churn import compute_features, drift_report, feature_set_hash


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


if __name__ == "__main__":
    unittest.main()
