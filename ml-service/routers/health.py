from fastapi import APIRouter
from fastapi.responses import JSONResponse
import sys
import os

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok", "python": sys.version}


@router.get("/v1/models")
def model_status():
    # Import here to avoid circular at module load
    from main import registry
    return registry.all_meta()
