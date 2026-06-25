FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY onnx-serving/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY models/ ./models/
COPY onnx-serving/server.py ./server.py

ENV PYTHONUNBUFFERED=1
ENV MODEL_DIR=/app/models

EXPOSE 8000

CMD ["python", "server.py", "--port", "8000", "--model-dir", "/app/models"]
