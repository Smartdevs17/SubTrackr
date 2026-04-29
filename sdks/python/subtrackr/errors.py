class SubTrackrError(Exception):
    def __init__(self, message: str, status_code: int = None, code: str = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code

class AuthenticationError(SubTrackrError):
    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, 401, "unauthorized")

class ApiError(SubTrackrError):
    pass
