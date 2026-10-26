FROM python:3.10-slim
WORKDIR /app
RUN apt-get update && apt-get install -y gcc curl && rm -rf /var/lib/apt/lists/*
COPY ml-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt || true
COPY ml-service/ .
EXPOSE 8000