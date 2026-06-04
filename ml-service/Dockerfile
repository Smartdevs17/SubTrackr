FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Include the existing ML models from the backend
COPY ../backend/ml ./backend/ml
COPY . .

ENV ML_SERVICE_URL=http://localhost:8000

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
