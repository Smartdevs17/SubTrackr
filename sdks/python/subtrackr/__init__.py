from .client import SubTrackrClient, UnsupportedVersionError
from .errors import SubTrackrError, AuthenticationError, ApiError
from .version import (
    SDK_VERSION,
    CURRENT_API_VERSION,
    MIN_SUPPORTED_API_VERSION,
    assess_api_version_compatibility,
    deprecated,
    warn_deprecated,
    RemovedError,
    throw_if_removed,
    reset_warned,
)

__all__ = [
    # Client
    "SubTrackrClient",
    "UnsupportedVersionError",
    # Errors
    "SubTrackrError",
    "AuthenticationError",
    "ApiError",
    # Versioning
    "SDK_VERSION",
    "CURRENT_API_VERSION",
    "MIN_SUPPORTED_API_VERSION",
    "assess_api_version_compatibility",
    # Deprecation
    "deprecated",
    "warn_deprecated",
    "RemovedError",
    "throw_if_removed",
    "reset_warned",
]
