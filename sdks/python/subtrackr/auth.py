from .errors import AuthenticationError
import time

class AuthManager:
    def __init__(self, api_key: str):
        if not api_key:
            raise AuthenticationError("API Key is required to initialize the SDK")
        self.token = api_key
        self.expires_at = time.time() + (30 * 24 * 60 * 60)

    def get_token(self) -> str:
        if not self.token:
            raise AuthenticationError("Not authenticated")
        return self.token
