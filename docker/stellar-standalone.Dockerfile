# Minimal Docker image for a Soroban/Stellar standalone test network
# This image is intended for CI/local integration tests only.
FROM --platform=linux/amd64 ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y curl ca-certificates jq netcat-openbsd git && rm -rf /var/lib/apt/lists/*

# Placeholder soroban server binary - CI should replace with real soroban/stellar standalone binary
RUN mkdir -p /opt/soroban && cat > /opt/soroban/soroban-server <<'EOF'\n#!/bin/sh\necho "[soroban-standalone] starting (placeholder)"\n# simple HTTP health endpoint using netcat in background\n(while true; do echo -e "HTTP/1.1 200 OK\n\nOK" | nc -l -p 8000 -q 1; done) &\n# keep container running\nwhile sleep 3600; do :; done\nEOF\nRUN chmod +x /opt/soroban/soroban-server

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8000 11626

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
