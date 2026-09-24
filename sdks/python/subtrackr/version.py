"""
version.py

Issue #1178 — Implement SDK versioning with deprecation policy

Single source of truth for the Python SDK version and deprecation utilities.
"""

from __future__ import annotations

import functools
import warnings
from typing import Any, Callable, Optional, TypeVar

# ── SDK version ───────────────────────────────────────────────────────────────

SDK_VERSION: str = "2.0.0"
SDK_VERSION_TUPLE: tuple[int, int, int] = (2, 0, 0)

# ── API version ───────────────────────────────────────────────────────────────

CURRENT_API_VERSION: int = 2
MIN_SUPPORTED_API_VERSION: int = 1


# ── Version compatibility ─────────────────────────────────────────────────────

def assess_api_version_compatibility(api_version: int) -> dict[str, Any]:
    """
    Assess whether an API version is supported by this SDK.

    Returns a dict with keys:
      supported  (bool)
      deprecated (bool)
      removed    (bool)
      message    (str | None)
    """
    if api_version < MIN_SUPPORTED_API_VERSION:
        return {
            "supported": False,
            "deprecated": True,
            "removed": False,
            "message": (
                f"API version {api_version} is deprecated and will be removed in a future release. "
                f"Please migrate to API v{CURRENT_API_VERSION}."
            ),
        }

    if api_version > CURRENT_API_VERSION:
        return {
            "supported": False,
            "deprecated": False,
            "removed": False,
            "message": (
                f"API version {api_version} is newer than this SDK (v{SDK_VERSION}). "
                f"Upgrade to the latest SDK."
            ),
        }

    return {"supported": True, "deprecated": False, "removed": False, "message": None}


# ── Deprecation helpers ───────────────────────────────────────────────────────

_warned: set[str] = set()

F = TypeVar("F", bound=Callable[..., Any])


def warn_deprecated(
    method: str,
    deprecated_in: str,
    removed_in: str,
    replacement: Optional[str] = None,
    note: Optional[str] = None,
) -> None:
    """
    Emit a DeprecationWarning once per process for *method*.
    Subsequent calls for the same method are silently ignored.
    """
    if method in _warned:
        return
    _warned.add(method)

    parts = [
        f"[SubTrackr SDK v{SDK_VERSION}] DEPRECATED: {method}() was deprecated in v{deprecated_in}",
        f"and will be removed in v{removed_in}.",
    ]
    if replacement:
        parts.append(f"Use {replacement} instead.")
    if note:
        parts.append(note)

    warnings.warn(" ".join(parts), DeprecationWarning, stacklevel=3)


def deprecated(
    deprecated_in: str,
    removed_in: str,
    replacement: Optional[str] = None,
    note: Optional[str] = None,
) -> Callable[[F], F]:
    """
    Decorator that wraps a function with a one-time DeprecationWarning.

    Usage::

        @deprecated(deprecated_in="2.0.0", removed_in="3.0.0", replacement="list_subscriptions()")
        def get_subscriptions(self):
            return self.list_subscriptions()
    """

    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            warn_deprecated(
                method=func.__name__,
                deprecated_in=deprecated_in,
                removed_in=removed_in,
                replacement=replacement,
                note=note,
            )
            return func(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return decorator


class RemovedError(Exception):
    """Raised when a caller invokes a method that has been removed from the SDK."""

    def __init__(self, method: str, removed_in: str, replacement: Optional[str] = None) -> None:
        hint = f" Use {replacement} instead." if replacement else " See the migration guide."
        super().__init__(f"{method}() was removed in SDK v{removed_in}.{hint}")
        self.method = method
        self.removed_in = removed_in
        self.replacement = replacement


def throw_if_removed(method: str, removed_in: str, replacement: Optional[str] = None) -> None:
    """Raise RemovedError immediately. Place at the top of removed method bodies."""
    raise RemovedError(method=method, removed_in=removed_in, replacement=replacement)


def reset_warned() -> None:
    """Clear the warned set — intended for unit tests only."""
    _warned.clear()
