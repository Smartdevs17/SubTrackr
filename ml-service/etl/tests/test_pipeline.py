"""Tests for the ETL pipeline module."""

import unittest
try:
    from ml_service.etl.config import ETLConfig, FeatureStoreConfig, FeatureStoreType
    from ml_service.etl.extractors import (
        SubscriptionExtractor,
        PaymentExtractor,
        UsageExtractor,
        ChurnSignalExtractor,
    )
    from ml_service.etl.transformers import (
        NormalizationTransformer,
        AggregationTransformer,
        FeatureDerivationTransformer,
        DeduplicationTransformer,
    )
    from ml_service.etl.loaders import InMemoryFeatureStore, create_feature_store
    from ml_service.etl.pipeline import ETLPipeline
    from ml_service.etl.monitoring import ETLMonitor
except ModuleNotFoundError:
    from etl.config import ETLConfig, FeatureStoreConfig, FeatureStoreType
    from etl.extractors import (
        SubscriptionExtractor,
        PaymentExtractor,
        UsageExtractor,
        ChurnSignalExtractor,
    )
    from etl.transformers import (
        NormalizationTransformer,
        AggregationTransformer,
        FeatureDerivationTransformer,
        DeduplicationTransformer,
    )
    from etl.loaders import InMemoryFeatureStore, create_feature_store
    from etl.pipeline import ETLPipeline
    from etl.monitoring import ETLMonitor


class TestExtractors(unittest.TestCase):
    def test_subscription_extractor(self):
        extractor = SubscriptionExtractor()
        data = {
            "subscriptions": [
                {
                    "id": "sub_1",
                    "subscriber": "0xABC",
                    "plan_id": "plan_1",
                    "price": 9.99,
                    "currency": "USD",
                    "isActive": True,
                    "billingCycle": "monthly",
                    "createdAt": "2025-01-01T00:00:00Z",
                    "totalPaid": 49.95,
                    "chargeCount": 5,
                }
            ]
        }
        features = extractor.extract(data)
        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]["subscriber"], "0xABC")
        self.assertTrue(extractor.validate(features))

    def test_payment_extractor(self):
        extractor = PaymentExtractor()
        data = {
            "payments": [
                {"subscriber": "0xABC", "subscription_id": "sub_1", "amount": 9.99, "status": "success"}
            ]
        }
        features = extractor.extract(data)
        self.assertEqual(len(features), 1)
        self.assertTrue(features[0]["is_success"])

    def test_churn_signal_extractor(self):
        extractor = ChurnSignalExtractor()
        data = {
            "churn_signals": [
                {
                    "subscriber": "0xABC",
                    "recentPaymentFailures": 2,
                    "baselineLoginsPerMonth": 20,
                    "recentLogins": 5,
                    "openSupportTickets": 1,
                }
            ]
        }
        features = extractor.extract(data)
        self.assertEqual(len(features), 1)
        self.assertAlmostEqual(features[0]["login_frequency_drop"], 0.75)


class TestTransformers(unittest.TestCase):
    def test_normalization(self):
        features = [{"score": 10}, {"score": 20}, {"score": 30}]
        transformer = NormalizationTransformer(columns=["score"])
        result = transformer.transform(features)
        self.assertAlmostEqual(result[0]["score_normalized"], 0.0)
        self.assertAlmostEqual(result[2]["score_normalized"], 1.0)

    def test_aggregation(self):
        features = [
            {"subscriber": "0xABC", "amount": 10},
            {"subscriber": "0xABC", "amount": 20},
            {"subscriber": "0xDEF", "amount": 30},
        ]
        transformer = AggregationTransformer(group_by="subscriber", aggregations={"amount": "sum"})
        result = transformer.transform(features)
        self.assertEqual(len(result), 2)

    def test_deduplication(self):
        features = [
            {"subscriber": "0xABC", "value": 1},
            {"subscriber": "0xABC", "value": 2},
            {"subscriber": "0xDEF", "value": 3},
        ]
        transformer = DeduplicationTransformer(key="subscriber")
        result = transformer.transform(features)
        self.assertEqual(len(result), 2)


class TestFeatureStore(unittest.TestCase):
    def test_in_memory_store(self):
        store = InMemoryFeatureStore()
        features = [{"subscriber": "0xABC", "score": 0.8}]
        written = store.write_features("test", features)
        self.assertEqual(written, 1)
        read = store.read_features("test")
        self.assertEqual(len(read), 1)
        self.assertEqual(read[0]["subscriber"], "0xABC")

    def test_create_feature_store(self):
        store = create_feature_store("inmemory")
        self.assertIsInstance(store, InMemoryFeatureStore)


class TestETLPipeline(unittest.TestCase):
    def test_pipeline_execution(self):
        config = ETLConfig(
            feature_sources=["subscriptions"],
            feature_store=FeatureStoreConfig(store_type=FeatureStoreType.INMEMORY),
        )
        pipeline = ETLPipeline(config)
        source_data = {
            "subscriptions": [
                {
                    "id": "sub_1",
                    "subscriber": "0xABC",
                    "price": 9.99,
                    "currency": "USD",
                    "isActive": True,
                    "billingCycle": "monthly",
                    "createdAt": "2025-01-01T00:00:00Z",
                }
            ]
        }
        result = pipeline.run(source_data)
        self.assertTrue(result.success)
        self.assertEqual(result.records_extracted, 1)

    def test_monitor_metrics(self):
        monitor = ETLMonitor()
        monitor.record_pipeline_start()
        monitor.record_pipeline_end(type("Result", (), {
            "success": True, "records_extracted": 10, "records_loaded": 10,
            "duration_ms": 100, "errors": []
        })())
        summary = monitor.get_metrics_summary()
        self.assertEqual(summary["total_runs"], 1)


if __name__ == "__main__":
    unittest.main()
