"""Performance benchmarks for the ETL pipeline."""

import json
import time
from typing import Dict, List

from ml_service.etl.config import ETLConfig, FeatureStoreConfig, FeatureStoreType
from ml_service.etl.extractors import SubscriptionExtractor, PaymentExtractor, ChurnSignalExtractor
from ml_service.etl.transformers import NormalizationTransformer, AggregationTransformer
from ml_service.etl.loaders import InMemoryFeatureStore
from ml_service.etl.pipeline import ETLPipeline


def generate_test_data(n_subscribers: int = 100) -> Dict[str, list]:
    """Generate synthetic test data for benchmarking."""
    subscriptions = [
        {
            "id": f"sub_{i}",
            "subscriber": f"0x{i:04d}",
            "plan_id": f"plan_{i % 5}",
            "price": 9.99 + (i % 10),
            "currency": "USD",
            "isActive": i % 10 != 0,
            "billingCycle": ["monthly", "yearly"][i % 2],
            "createdAt": "2025-01-01T00:00:00Z",
            "totalPaid": (9.99 + (i % 10)) * (i % 12 + 1),
            "chargeCount": i % 12 + 1,
            "totalGasSpent": 0.01 * (i % 12 + 1),
        }
        for i in range(n_subscribers)
    ]

    payments = [
        {
            "subscriber": f"0x{i:04d}",
            "subscription_id": f"sub_{i}",
            "amount": 9.99 + (i % 10),
            "status": "success" if i % 10 != 0 else "failed",
            "gasCost": 0.01,
        }
        for i in range(n_subscribers)
    ]

    churn_signals = [
        {
            "subscriber": f"0x{i:04d}",
            "recentPaymentFailures": i % 5,
            "baselineLoginsPerMonth": 20,
            "recentLogins": max(0, 20 - (i % 15)),
            "openSupportTickets": i % 3,
            "priceSensitivityIndex": 0.5 + (i % 10) * 0.05,
        }
        for i in range(n_subscribers)
    ]

    return {
        "subscriptions": subscriptions,
        "payments": payments,
        "churn_signals": churn_signals,
    }


def benchmark_extraction(n_records: int = 1000) -> Dict[str, float]:
    """Benchmark extraction performance."""
    data = generate_test_data(n_records)
    results = {}

    for name, extractor_cls in [
        ("SubscriptionExtractor", SubscriptionExtractor),
        ("PaymentExtractor", PaymentExtractor),
        ("ChurnSignalExtractor", ChurnSignalExtractor),
    ]:
        extractor = extractor_cls()
        start = time.perf_counter()
        features = extractor.extract({name.replace("Extractor", "").lower() + "s": data.get(name.replace("Extractor", "").lower() + "s", [])})
        elapsed = (time.perf_counter() - start) * 1000
        results[name] = {
            "duration_ms": round(elapsed, 3),
            "records_per_ms": round(n_records / max(elapsed, 0.001), 2),
            "records_extracted": len(features),
        }

    return results


def benchmark_transformation(n_records: int = 1000) -> Dict[str, float]:
    """Benchmark transformation performance."""
    data = generate_test_data(n_records)
    features = SubscriptionExtractor().extract({"subscriptions": data["subscriptions"]})
    results = {}

    for name, transformer in [
        ("NormalizationTransformer", NormalizationTransformer()),
        ("AggregationTransformer", AggregationTransformer(group_by="subscriber", aggregations={"price": "sum"})),
    ]:
        start = time.perf_counter()
        transformed = transformer.transform(features.copy() if hasattr(features, 'copy') else list(features))
        elapsed = (time.perf_counter() - start) * 1000
        results[name] = {
            "duration_ms": round(elapsed, 3),
            "input_records": len(features),
            "output_records": len(transformed),
        }

    return results


def benchmark_load(n_records: int = 1000) -> Dict[str, float]:
    """Benchmark feature store load performance."""
    store = InMemoryFeatureStore()
    features = [{"subscriber": f"0x{i:04d}", "value": i} for i in range(n_records)]

    start = time.perf_counter()
    written = store.write_features("benchmark", features)
    elapsed = (time.perf_counter() - start) * 1000

    start = time.perf_counter()
    read = store.read_features("benchmark")
    read_elapsed = (time.perf_counter() - start) * 1000

    return {
        "write_duration_ms": round(elapsed, 3),
        "read_duration_ms": round(read_elapsed, 3),
        "records_written": written,
        "records_read": len(read),
        "write_records_per_ms": round(n_records / max(elapsed, 0.001), 2),
    }


def benchmark_pipeline(n_records: int = 500) -> Dict[str, float]:
    """Benchmark full pipeline execution."""
    config = ETLConfig(
        feature_sources=["subscriptions", "payments", "churn_signals"],
        feature_store=FeatureStoreConfig(store_type=FeatureStoreType.INMEMORY),
    )
    pipeline = ETLPipeline(config)

    data = generate_test_data(n_records)
    start = time.perf_counter()
    result = pipeline.run(data)
    elapsed = (time.perf_counter() - start) * 1000

    return {
        "total_duration_ms": round(elapsed, 3),
        "records_extracted": result.records_extracted,
        "records_transformed": result.records_transformed,
        "records_loaded": result.records_loaded,
        "success": result.success,
        "throughput_records_per_sec": round(n_records / max(elapsed / 1000, 0.001), 2),
    }


def run_all_benchmarks(n_records: int = 1000) -> Dict[str, Dict]:
    """Run all benchmarks and return results."""
    print(f"Running ETL benchmarks with {n_records} records...")
    results = {}

    print("  Benchmarking extraction...")
    results["extraction"] = benchmark_extraction(n_records)

    print("  Benchmarking transformation...")
    results["transformation"] = benchmark_transformation(n_records)

    print("  Benchmarking load...")
    results["load"] = benchmark_load(n_records)

    print("  Benchmarking full pipeline...")
    results["pipeline"] = benchmark_pipeline(n_records)

    return results


if __name__ == "__main__":
    results = run_all_benchmarks(1000)
    print(json.dumps(results, indent=2))
