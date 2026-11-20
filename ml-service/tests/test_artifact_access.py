"""Tests for least-privilege artifact grants (#2103)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import artifact_access as aa  # noqa: E402


def test_inference_reads_only_onnx_models():
    assert aa.is_allowed("ml-inference", aa.READ, "models/onnx/churn.onnx")
    assert not aa.is_allowed("ml-inference", aa.READ, "models/registry/v1.1.json")
    assert not aa.is_allowed("ml-inference", aa.WRITE, "models/onnx/churn.onnx")


def test_api_is_read_only_on_registry():
    assert aa.is_allowed("ml-service-api", aa.READ, "models/registry/v1.1.json")
    assert not aa.is_allowed("ml-service-api", aa.READ, "models/onnx/churn.onnx")
    assert not aa.is_allowed("ml-service-api", aa.WRITE, "models/registry/v1.2.json")


def test_trainer_writes_only_registry_and_onnx():
    assert aa.is_allowed("ml-model-trainer", aa.WRITE, "models/registry/v1.2.json")
    assert aa.is_allowed("ml-model-trainer", aa.WRITE, "models/onnx/churn.onnx")
    assert not aa.is_allowed("ml-model-trainer", aa.WRITE, "features/daily/2026-11-19.json")


def test_feature_pipeline_writes_only_daily_features():
    assert aa.is_allowed("ml-feature-pipeline", aa.WRITE, "features/daily/2026-11-19.json")
    assert not aa.is_allowed("ml-feature-pipeline", aa.READ, "models/onnx/churn.onnx")
    assert not aa.is_allowed("ml-feature-pipeline", aa.WRITE, "models/registry/v1.2.json")


def test_unknown_workload_is_denied():
    assert not aa.is_allowed("ml-unknown", aa.READ, "models/onnx/churn.onnx")


@pytest.mark.parametrize(
    "key",
    [
        "",
        "/models/onnx/churn.onnx",
        "models/onnx/../registry/v1.1.json",
        "models/onnx/../../secrets/x",
    ],
)
def test_traversal_and_absolute_keys_are_denied(key):
    assert not aa.is_allowed("ml-inference", aa.READ, key)


def test_require_raises_for_denied_access():
    with pytest.raises(PermissionError):
        aa.require("ml-inference", aa.WRITE, "models/onnx/churn.onnx")


def test_require_allows_granted_access():
    aa.require("ml-inference", aa.READ, "models/onnx/churn.onnx")


def test_current_workload_reads_env(monkeypatch):
    monkeypatch.setenv(aa.WORKLOAD_ENV, "ml-inference")
    assert aa.current_workload() == "ml-inference"


def test_current_workload_rejects_missing_or_unknown(monkeypatch):
    monkeypatch.delenv(aa.WORKLOAD_ENV, raising=False)
    with pytest.raises(RuntimeError):
        aa.current_workload()
    monkeypatch.setenv(aa.WORKLOAD_ENV, "not-a-workload")
    with pytest.raises(RuntimeError):
        aa.current_workload()
