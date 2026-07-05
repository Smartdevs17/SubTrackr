from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import time
import logging

from routers import churn, recommendations, pricing, health, anomaly
from model_registry import ModelRegistry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

registry = ModelRegistry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    registry.load_all()
    logger.info("ML models loaded")
    yield
    logger.info("ML service shutting down")


app = FastAPI(title="SubTrackr ML Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def track_latency(request, call_next):
    start = time.time()
    response = await call_next(request)
    latency_ms = (time.time() - start) * 1000
    response.headers["X-Latency-Ms"] = str(round(latency_ms, 2))
    logger.info(f"{request.method} {request.url.path} — {latency_ms:.1f}ms")
    return response


app.include_router(health.router)
app.include_router(churn.router, prefix="/v1/churn")
app.include_router(recommendations.router, prefix="/v1/recommendations")
app.include_router(pricing.router, prefix="/v1/pricing")
app.include_router(anomaly.router, prefix="/v1/anomaly")
