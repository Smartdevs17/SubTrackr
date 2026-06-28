"""
ONNX Runtime inference server with INT8 quantized models.
Provides REST API for model inference with request batching and provider fallback.

Usage:
    python server.py
    python server.py --port 8080 --model-dir /app/models
"""

import argparse
import logging
import os
import time
from typing import Any, Optional, Dict

import numpy as np
import onnxruntime as ort

try:
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import JSONResponse
    import uvicorn
    from pydantic import BaseModel
except ImportError:
    FastAPI = None
    BaseModel = None
    uvicorn = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


class InferenceRequest(BaseModel):
    model_type: str
    data: list
    batch_size: int = 1


class ONNXInferenceServer:
    """Inference server managing multiple ONNX models with provider fallback."""

    def __init__(self, model_dir: str = "/app/models"):
        self.model_dir = model_dir
        self.sessions: Dict[str, ort.InferenceSession] = {}
        self.fallback_sessions: Dict[str, Any] = {}
        self.metadata: Dict[str, dict] = {}
        self._load_models()

    def _get_providers(self) -> list:
        """Get available providers with fallback."""
        available = ort.get_available_providers()
        logger.info(f"Available ONNX providers: {available}")

        preferred = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        providers = [p for p in preferred if p in available]
        if not providers:
            providers = ["CPUExecutionProvider"]
        return providers

    def _load_model(self, model_type: str, quantized: bool = True) -> Optional[ort.InferenceSession]:
        """Load a single ONNX model, with fallback to unquantized."""
        model_name = f"{model_type}_int8" if quantized else model_type
        model_path = os.path.join(self.model_dir, f"{model_name}.onnx")

        if not os.path.exists(model_path):
            if quantized:
                logger.warning(f"Quantized model {model_path} not found, trying unquantized")
                return self._load_model(model_type, quantized=False)
            logger.error(f"Model {model_path} not found")
            return None

        try:
            providers = self._get_providers()
            session = ort.InferenceSession(model_path, providers=providers)
            logger.info(f"Loaded model {model_name} with providers: {session.get_providers()}")
            return session
        except Exception as e:
            logger.error(f"Failed to load model {model_name}: {e}")
            if quantized:
                logger.info("Falling back to unquantized model")
                return self._load_model(model_type, quantized=False)
            return None

    def _load_models(self):
        """Load all available models."""
        for model_type in ["churn", "pricing", "recommendation"]:
            session = self._load_model(model_type)
            if session:
                self.sessions[model_type] = session
                input_meta = session.get_inputs()[0]
                output_meta = session.get_outputs()[0]
                self.metadata[model_type] = {
                    "input_shape": input_meta.shape,
                    "input_type": str(input_meta.type),
                    "output_shape": output_meta.shape,
                    "loaded": True,
                }
            else:
                self.metadata[model_type] = {"loaded": False}
                logger.warning(f"Model {model_type} failed to load; PyTorch fallback may be needed")

    def predict(self, model_type: str, data: np.ndarray) -> np.ndarray:
        """Run inference on a single model."""
        if model_type not in self.sessions:
            raise ValueError(f"Model '{model_type}' not loaded")

        session = self.sessions[model_type]
        input_name = session.get_inputs()[0].name
        return session.run(None, {input_name: data})[0]

    def predict_batch(self, model_type: str, data: np.ndarray, batch_size: int = 32) -> np.ndarray:
        """Run batched inference, splitting large inputs into batches."""
        if model_type not in self.sessions:
            raise ValueError(f"Model '{model_type}' not loaded")

        session = self.sessions[model_type]
        input_name = session.get_inputs()[0].name
        n_samples = data.shape[0]
        all_outputs = []

        for start in range(0, n_samples, batch_size):
            end = min(start + batch_size, n_samples)
            batch = data[start:end]
            output = session.run(None, {input_name: batch})[0]
            all_outputs.append(output)

        return np.concatenate(all_outputs, axis=0)


def create_app(model_dir: str = "/app/models") -> Any:
    """Create the FastAPI application."""
    if FastAPI is None:
        raise ImportError("FastAPI is required. Install with: pip install fastapi uvicorn")

    server = ONNXInferenceServer(model_dir)
    app = FastAPI(title="SubTrackr ML Inference", version="1.0.0")

    @app.get("/health")
    async def health():
        return {
            "status": "healthy",
            "models": {
                name: meta
                for name, meta in server.metadata.items()
            },
            "providers": ort.get_available_providers(),
        }

    @app.post("/predict/{model_type}")
    async def predict(model_type: str, request: InferenceRequest):
        if model_type not in server.metadata:
            raise HTTPException(status_code=404, detail=f"Model '{model_type}' not found")

        start = time.time()
        data = np.array(request.data, dtype=np.float32)

        try:
            if request.batch_size > 1 and data.ndim == 2:
                output = server.predict_batch(model_type, data, request.batch_size)
            else:
                output = server.predict(model_type, data)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        latency_ms = (time.time() - start) * 1000
        logger.info(f"Prediction {model_type}: {latency_ms:.2f}ms, shape={output.shape}")

        return {
            "model_type": model_type,
            "output": output.tolist(),
            "latency_ms": round(latency_ms, 2),
            "shape": list(output.shape),
        }

    @app.post("/predict/batch")
    async def predict_batch(request: Request):
        body = await request.json()
        model_type = body.get("model_type")
        data_list = body.get("data", [])
        batch_size = body.get("batch_size", 32)

        if not model_type:
            raise HTTPException(status_code=400, detail="model_type is required")

        start = time.time()
        data = np.array(data_list, dtype=np.float32)

        try:
            output = server.predict_batch(model_type, data, batch_size)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        latency_ms = (time.time() - start) * 1000

        return {
            "model_type": model_type,
            "output": output.tolist(),
            "latency_ms": round(latency_ms, 2),
            "shape": list(output.shape),
        }

    return app


def main():
    parser = argparse.ArgumentParser(description="ONNX Runtime inference server")
    parser.add_argument("--port", type=int, default=8000, help="Server port")
    parser.add_argument("--host", default="0.0.0.0", help="Server host")
    parser.add_argument("--model-dir", default="/app/models", help="Model directory")
    args = parser.parse_args()

    if uvicorn is None:
        logger.error("uvicorn not installed. Install with: pip install uvicorn")
        return

    app = create_app(args.model_dir)
    logger.info(f"Starting server on {args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
