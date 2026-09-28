"""
client.py

Issue #1178 — Implement SDK versioning with deprecation policy

SubTrackr Python SDK client with SDK/API versioning, X-SDK-Version header
injection, and deprecation wrappers for renamed methods.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import requests

from .version import (
    SDK_VERSION,
    CURRENT_API_VERSION,
    MIN_SUPPORTED_API_VERSION,
    assess_api_version_compatibility,
    deprecated,
    warn_deprecated,
)


class UnsupportedVersionError(Exception):
    """Raised when the configured API version is not supported by this SDK."""

    def __init__(self, requested: int, minimum: int) -> None:
        super().__init__(
            f"API version {requested} is not supported. "
            f"Minimum supported version is {minimum}."
        )
        self.requested_version = requested
        self.min_supported_version = minimum


class SubTrackrClient:
    """
    Official SubTrackr Python SDK client.

    Parameters
    ----------
    base_url:
        API base URL (defaults to production).
    api_key:
        API key for authentication.
    token:
        Bearer token (alternative to api_key).
    api_version:
        Target API version (default: CURRENT_API_VERSION).
        Must be >= MIN_SUPPORTED_API_VERSION.
    warn_on_deprecation:
        Whether to emit DeprecationWarning for deprecated methods.
        Default: True.
    """

    def __init__(
        self,
        base_url: str = "https://api.subtrackr.io/v1",
        api_key: Optional[str] = None,
        token: Optional[str] = None,
        api_version: int = CURRENT_API_VERSION,
        warn_on_deprecation: bool = True,
    ) -> None:
        # Validate requested API version
        if api_version < MIN_SUPPORTED_API_VERSION:
            raise UnsupportedVersionError(api_version, MIN_SUPPORTED_API_VERSION)

        compat = assess_api_version_compatibility(api_version)
        if compat["removed"]:
            raise UnsupportedVersionError(api_version, MIN_SUPPORTED_API_VERSION)

        if warn_on_deprecation and compat["deprecated"] and compat["message"]:
            import warnings
            warnings.warn(
                f"[SubTrackr SDK v{SDK_VERSION}] {compat['message']}",
                DeprecationWarning,
                stacklevel=2,
            )

        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.token = token
        self.api_version = api_version
        self.warn_on_deprecation = warn_on_deprecation

    # ── Headers ──────────────────────────────────────────────────────────────

    def _headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {
            "Content-Type": "application/json",
            "X-SDK-Version": SDK_VERSION,
            "X-API-Version": str(self.api_version),
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    # ── Version introspection ─────────────────────────────────────────────────

    def get_sdk_version(self) -> str:
        """Returns the SDK version string, e.g. '2.0.0'."""
        return SDK_VERSION

    def get_api_version(self) -> int:
        """Returns the API version this client is configured to use."""
        return self.api_version

    # ── Current REST methods ──────────────────────────────────────────────────

    def list_subscriptions(self) -> List[Dict[str, Any]]:
        """List all subscriptions (current, preferred method)."""
        response = requests.get(
            f"{self.base_url}/subscriptions", headers=self._headers()
        )
        response.raise_for_status()
        return response.json()  # type: ignore[no-any-return]

    def create_subscription(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new subscription."""
        response = requests.post(
            f"{self.base_url}/subscriptions", json=payload, headers=self._headers()
        )
        response.raise_for_status()
        return response.json()  # type: ignore[no-any-return]

    # ── Deprecated aliases ────────────────────────────────────────────────────

    @deprecated(
        deprecated_in="2.0.0",
        removed_in="3.0.0",
        replacement="list_subscriptions()",
        note="list_subscriptions() returns the same data with the updated response envelope.",
    )
    def get_subscriptions(self) -> List[Dict[str, Any]]:
        """
        .. deprecated:: 2.0.0
           Use :meth:`list_subscriptions` instead.
        """
        return self.list_subscriptions()
