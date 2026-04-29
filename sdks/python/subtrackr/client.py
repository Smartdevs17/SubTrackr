import requests
from typing import List, Dict, Any, Optional
from .auth import AuthManager
from .errors import ApiError
from .types import Subscription, Webhook

class SubTrackrClient:
    def __init__(self, api_key: str, environment: str = "production", base_url: Optional[str] = None):
        self.auth_manager = AuthManager(api_key)
        self.base_url = base_url or (
            "https://sandbox.api.subtrackr.app" if environment == "sandbox"
            else "https://api.subtrackr.app"
        )
        self.session = requests.Session()

    def _request(self, method: str, endpoint: str, json: Optional[Dict[str, Any]] = None) -> Any:
        token = self.auth_manager.get_token()
        url = f"{self.base_url}{endpoint}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        response = self.session.request(method, url, headers=headers, json=json)

        if not response.ok:
            try:
                error_data = response.json()
                message = error_data.get("message", "API request failed")
                code = error_data.get("code")
            except Exception:
                message = response.reason
                code = None
            raise ApiError(message, response.status_code, code)

        return response.json()

    def get_subscriptions(self) -> List[Subscription]:
        return self._request("GET", "/v1/subscriptions")

    def create_subscription(self, data: Dict[str, Any]) -> Subscription:
        return self._request("POST", "/v1/subscriptions", json=data)

    def get_webhooks(self) -> List[Webhook]:
        return self._request("GET", "/v1/webhooks")

    def create_webhook(self, data: Dict[str, Any]) -> Webhook:
        return self._request("POST", "/v1/webhooks", json=data)
