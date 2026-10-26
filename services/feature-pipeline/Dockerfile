FROM python:3.12-slim

WORKDIR /app

COPY services/feature-pipeline/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/feature-pipeline .

ENV FEATURE_STORE_URL=redis://feature-store:6379/0

# Run as non-root user to reduce container attack surface
RUN useradd -m -u 1001 appuser
USER appuser

EXPOSE 8010
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010"]
