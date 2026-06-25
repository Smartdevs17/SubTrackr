"""
Accuracy regression test suite comparing ONNX quantized models vs PyTorch baselines.
"""
import logging
import os
import sys
from typing import Optional

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def compute_f1_score(y_true: np.ndarray, y_pred: np.ndarray, threshold: float = 0.5) -> float:
    """Compute F1 score for binary classification."""
    y_pred_binary = (y_pred > threshold).astype(np.int32)
    y_true_binary = y_true.astype(np.int32)

    tp = np.sum((y_pred_binary == 1) & (y_true_binary == 1))
    fp = np.sum((y_pred_binary == 1) & (y_true_binary == 0))
    fn = np.sum((y_pred_binary == 0) & (y_true_binary == 1))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    return f1


def test_onnx_vs_pytorch_accuracy(
    onnx_model_path: str,
    pytorch_model_path: Optional[str],
    test_data: np.ndarray,
    test_labels: Optional[np.ndarray] = None,
    tolerance: float = 0.01,
) -> bool:
    """
    Compare ONNX model accuracy against PyTorch baseline.
    Returns True if accuracy is within tolerance.
    """
    import onnxruntime as ort

    # ONNX inference
    session = ort.InferenceSession(onnx_model_path)
    input_name = session.get_inputs()[0].name
    onnx_output = session.run(None, {input_name: test_data.astype(np.float32)})[0]

    if pytorch_model_path and os.path.exists(pytorch_model_path):
        import torch

        # PyTorch inference
        model = torch.load(pytorch_model_path, map_location="cpu", weights_only=False)
        model.eval()
        with torch.no_grad():
            pt_output = model(torch.from_numpy(test_data).float()).numpy()

        mse = np.mean((onnx_output - pt_output) ** 2)
        logger.info(f"MSE between ONNX and PyTorch: {mse:.6f}")

        if mse > tolerance:
            logger.error(f"MSE {mse:.6f} exceeds tolerance {tolerance}")
            return False

        max_diff = np.max(np.abs(onnx_output - pt_output))
        logger.info(f"Max absolute difference: {max_diff:.6f}")

    if test_labels is not None:
        onnx_f1 = compute_f1_score(test_labels, onnx_output)
        logger.info(f"ONNX F1 score: {onnx_f1:.4f}")

        if pytorch_model_path and os.path.exists(pytorch_model_path):
            import torch
            model = torch.load(pytorch_model_path, map_location="cpu", weights_only=False)
            model.eval()
            with torch.no_grad():
                pt_output = model(torch.from_numpy(test_data).float()).numpy()
            pt_f1 = compute_f1_score(test_labels, pt_output)
            logger.info(f"PyTorch F1 score: {pt_f1:.4f}")

            f1_diff = abs(onnx_f1 - pt_f1)
            logger.info(f"F1 difference: {f1_diff:.4f}")

            if f1_diff > tolerance:
                logger.error(f"F1 difference {f1_diff:.4f} exceeds tolerance {tolerance}")
                return False

    return True


def generate_test_data(model_type: str, n_samples: int = 100):
    """Generate test data for each model type."""
    np.random.seed(42)

    if model_type == "churn":
        X = np.random.randn(n_samples, 20).astype(np.float32)
        y = (np.random.rand(n_samples) > 0.7).astype(np.int32)
    elif model_type == "pricing":
        X = np.random.randn(n_samples, 15).astype(np.float32)
        y = np.random.rand(n_samples).astype(np.float32) * 100
    elif model_type == "recommendation":
        X = np.random.randint(0, 1000, size=(n_samples, 1)).astype(np.int64)
        y = np.random.randint(0, 1000, size=(n_samples,)).astype(np.int32)
    else:
        raise ValueError(f"Unknown model type: {model_type}")

    return X, y


def main():
    """Run accuracy regression tests for all models."""
    model_dir = os.environ.get("MODEL_DIR", "/app/models")
    models = ["churn", "pricing", "recommendation"]
    all_passed = True

    for model_type in models:
        logger.info(f"Testing {model_type} model...")

        quantized_path = os.path.join(model_dir, f"{model_type}_int8.onnx")
        fp32_path = os.path.join(model_dir, f"{model_type}.onnx")
        pt_path = os.path.join(model_dir, f"{model_type}.pt")

        onnx_path = quantized_path if os.path.exists(quantized_path) else fp32_path

        if not os.path.exists(onnx_path):
            logger.warning(f"ONNX model not found for {model_type}, skipping")
            continue

        test_X, test_y = generate_test_data(model_type)

        passed = test_onnx_vs_pytorch_accuracy(
            onnx_model_path=onnx_path,
            pytorch_model_path=pt_path if os.path.exists(pt_path) else None,
            test_data=test_X,
            test_labels=test_y,
            tolerance=0.01,
        )

        if passed:
            logger.info(f"✓ {model_type}: Accuracy validation PASSED")
        else:
            logger.error(f"✗ {model_type}: Accuracy validation FAILED")
            all_passed = False

    if all_passed:
        logger.info("All accuracy tests passed")
        sys.exit(0)
    else:
        logger.error("Some accuracy tests failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
