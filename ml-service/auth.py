"""
ml-service/auth.py

API token verification for ml-service (#2099).

ML_SERVICE_API_TOKENS holds a comma-separated list of tokens. The first entry is
the current token. Any later entries are previous tokens that are still accepted
during the rotation grace period (see scripts/rotate-ml-token.sh). Clients send
one of them in the X-API-Key header.

Tokens are compared in constant time. When ML_SERVICE_API_TOKENS is unset the
check is off, so local development works without a token.
"""

import hmac
import os
from typing import Iterable, List, Optional

TOKEN_HEADER = "X-API-Key"
TOKENS_ENV = "ML_SERVICE_API_TOKENS"

# Probes and API docs stay reachable without a token.
EXEMPT_PATHS = frozenset({"/health", "/healthz", "/docs", "/openapi.json", "/redoc"})


def load_tokens() -> List[str]:
    """Read the accepted tokens from the environment."""
    raw = os.environ.get(TOKENS_ENV, "")
    return [token.strip() for token in raw.split(",") if token.strip()]


def is_authorized(presented: Optional[str], tokens: Iterable[str]) -> bool:
    """True when `presented` matches any accepted token. Every token is compared,
    so the timing does not reveal which one matched."""
    if not presented:
        return False
    presented_bytes = presented.encode("utf-8")
    matched = False
    for token in tokens:
        if hmac.compare_digest(presented_bytes, token.encode("utf-8")):
            matched = True
    return matched
