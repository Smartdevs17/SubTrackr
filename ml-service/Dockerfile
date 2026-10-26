FROM python:3.14-slim

WORKDIR /app

COPY ml-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Include the existing ML models from the backend
COPY backend/ml ./backend/ml
COPY services/feature-pipeline ./services/feature-pipeline
COPY ml-service .

ENV ML_SERVICE_URL=http://localhost:8000
ENV FEATURE_PIPELINE_PATH=/app/services/feature-pipeline
ENV FEATURE_STORE_URL=redis://feature-store:6379/0

# Run as non-root user to reduce container attack surface
RUN useradd -m -u 1001 appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
