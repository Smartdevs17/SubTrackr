from .client import SubTrackrClient, UnsupportedVersionError
from .errors import SubTrackrError, AuthenticationError, ApiError, parse_error_body, raise_for_response
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
    "parse_error_body",
    "raise_for_response",
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
