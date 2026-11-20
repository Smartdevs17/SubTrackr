from typing import Any, Dict, Optional


class SubTrackrError(Exception):
    def __init__(self, message: str, status_code: int = None, code: str = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        #: Server-assigned request id (envelope ``meta.requestId``).
        self.request_id: Optional[str] = None
        #: Per-field validation details (envelope ``error.details``).
        self.details: Optional[Dict[str, str]] = None


class AuthenticationError(SubTrackrError):
    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, 401, "unauthorized")


class ApiError(SubTrackrError):
    @property
    def retryable(self) -> bool:
        """Whether retrying the same request may succeed."""
        s = self.status_code or 0
        return s == 408 or s == 429 or s >= 500


def parse_error_body(body: Any, fallback_message: str) -> Dict[str, Any]:
    """Extract error info from a response body.

    Accepts the canonical envelope
    ``{"success": false, "error": {"code", "message", "details"}, "meta": {"requestId"}}``
    and the legacy shapes ``{"message", "code"}`` and ``{"error": "text"}``.
    """
    b = body if isinstance(body, dict) else {}
    meta = b.get("meta") if isinstance(b.get("meta"), dict) else {}
    request_id = meta.get("requestId") if isinstance(meta.get("requestId"), str) else None
    err = b.get("error")

    if isinstance(err, dict):
        message = err.get("message")
        details = err.get("details")
        code = err.get("code")
        return {
            "message": message if isinstance(message, str) and message else fallback_message,
            "code": code if isinstance(code, str) else None,
            "details": details if isinstance(details, dict) else None,
            "request_id": request_id,
        }

    code = b.get("code") if isinstance(b.get("code"), str) else None
    if isinstance(err, str) and err:
        return {"message": err, "code": code, "details": None, "request_id": request_id}

    message = b.get("message")
    return {
        "message": message if isinstance(message, str) and message else fallback_message,
        "code": code,
        "details": None,
        "request_id": request_id,
    }


def raise_for_response(response: Any) -> None:
    """Raise ApiError (or AuthenticationError for 401) when the response failed."""
    status = getattr(response, "status_code", 200)
    if status < 400:
        return
    try:
        body = response.json()
    except Exception:
        body = None
    fallback = getattr(response, "reason", None) or "API request failed"
    info = parse_error_body(body, fallback)
    if status == 401:
        error: SubTrackrError = AuthenticationError(info["message"])
    else:
        error = ApiError(info["message"], status, info["code"])
    error.request_id = info["request_id"]
    error.details = info["details"]
    raise error
