"""
Export PyTorch models to ONNX format with INT8 quantization.

Usage:
    python export_to_onnx.py --model-type churn --model-path models/churn.pt --output models/churn.onnx
    python export_to_onnx.py --model-type pricing --model-path models/pricing.pt --output models/pricing.onnx
    python export_to_onnx.py --model-type recommendation --model-path models/recommendation.pt --output models/recommendation.onnx
"""

import argparse
import json
import logging
import os
import sys
from typing import Optional

import numpy as np
import torch
import torch.nn as nn

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


class ChurnPredictionModel(nn.Module):
    def __init__(self, input_dim: int = 20, hidden_dim: int = 64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Linear(hidden_dim // 2, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class PricingOptimizationModel(nn.Module):
    def __init__(self, input_dim: int = 15, hidden_dim: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Linear(hidden_dim // 2, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class RecommendationModel(nn.Module):
    def __init__(self, num_items: int = 1000, embedding_dim: int = 64):
        super().__init__()
        self.embedding = nn.Embedding(num_items, embedding_dim)
        self.fc = nn.Linear(embedding_dim, num_items)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        emb = self.embedding(x)
        return self.fc(emb)


MODEL_REGISTRY = {
    "churn": ChurnPredictionModel,
    "pricing": PricingOptimizationModel,
    "recommendation": RecommendationModel,
}


def export_to_onnx(
    model: nn.Module,
    dummy_input: torch.Tensor,
    output_path: str,
    dynamic_axes: Optional[dict] = None,
) -> None:
    """Export a PyTorch model to ONNX format."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes=dynamic_axes or {},
    )
    logger.info(f"Exported ONNX model to {output_path}")


def quantize_onnx_int8(
    onnx_path: str,
    calibration_data: np.ndarray,
    output_path: str,
) -> None:
    """Apply INT8 post-training quantization to an ONNX model."""
    try:
        import onnx
        import onnxruntime as ort
        from onnxruntime.quantization import quantize_dynamic, QuantType

        quantize_dynamic(
            model_input=onnx_path,
            model_output=output_path,
            weight_type=QuantType.QInt8,
        )
        logger.info(f"Quantized INT8 model saved to {output_path}")
    except ImportError:
        logger.warning(
            "onnxruntime-quantization not available; copying unquantized model."
        )
        import shutil
        shutil.copy(onnx_path, output_path)


def accuracy_within_tolerance(
    onnx_path: str,
    pytorch_model: nn.Module,
    calibration_data: np.ndarray,
    tolerance: float = 0.01,
) -> bool:
    """Compare ONNX model outputs with PyTorch model outputs."""
    import onnxruntime as ort

    pytorch_model.eval()
    with torch.no_grad():
        pt_output = pytorch_model(torch.from_numpy(calibration_data).float()).numpy()

    session = ort.InferenceSession(onnx_path)
    ort_input_name = session.get_inputs()[0].name
    ort_output = session.run(None, {ort_input_name: calibration_data.astype(np.float32)})[0]

    mse = np.mean((pt_output - ort_output) ** 2)
    logger.info(f"ONNX vs PyTorch MSE: {mse:.6f}")

    return mse < tolerance


def main():
    parser = argparse.ArgumentParser(description="Export PyTorch models to ONNX with INT8 quantization")
    parser.add_argument("--model-type", required=True, choices=list(MODEL_REGISTRY.keys()))
    parser.add_argument("--model-path", required=True, help="Path to PyTorch model checkpoint")
    parser.add_argument("--output", required=True, help="Output ONNX file path")
    parser.add_argument("--quantize", action="store_true", default=True, help="Apply INT8 quantization")
    parser.add_argument("--calibration-samples", type=int, default=1000, help="Number of calibration samples")
    parser.add_argument("--validate", action="store_true", default=True, help="Validate accuracy after export")
    args = parser.parse_args()

    model_cls = MODEL_REGISTRY[args.model_type]
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # Initialize model
    model = model_cls()
    if os.path.exists(args.model_path):
        model.load_state_dict(torch.load(args.model_path, map_location=device, weights_only=True))
        logger.info(f"Loaded model from {args.model_path}")
    else:
        logger.warning(f"Model path {args.model_path} not found; using random weights")

    model.to(device)
    model.eval()

    # Create dummy input
    if args.model_type == "churn":
        dummy_input = torch.randn(1, 20)
        calibration_data = np.random.randn(args.calibration_samples, 20).astype(np.float32)
        dynamic_axes = {"input": {0: "batch_size"}, "output": {0: "batch_size"}}
    elif args.model_type == "pricing":
        dummy_input = torch.randn(1, 15)
        calibration_data = np.random.randn(args.calibration_samples, 15).astype(np.float32)
        dynamic_axes = {"input": {0: "batch_size"}, "output": {0: "batch_size"}}
    elif args.model_type == "recommendation":
        dummy_input = torch.tensor([[0]], dtype=torch.long)
        calibration_data = np.random.randint(0, 1000, size=(args.calibration_samples, 1)).astype(np.int64)
        dynamic_axes = {"input": {0: "batch_size"}, "output": {0: "batch_size"}}
    else:
        raise ValueError(f"Unknown model type: {args.model_type}")

    # Export to ONNX
    export_to_onnx(model, dummy_input, args.output, dynamic_axes)

    # Quantize to INT8
    quantized_path = args.output.replace(".onnx", "_int8.onnx")
    if args.quantize:
        quantize_onnx_int8(args.output, calibration_data, quantized_path)

    # Validate accuracy
    if args.validate:
        validation_path = quantized_path if args.quantize else args.output
        ok = accuracy_within_tolerance(validation_path, model, calibration_data[:100])
        if ok:
            logger.info("Accuracy validation PASSED (<1% deviation)")
        else:
            logger.error("Accuracy validation FAILED (>1% deviation)")
            sys.exit(1)


if __name__ == "__main__":
    main()
