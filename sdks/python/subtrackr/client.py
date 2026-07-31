import requests
from typing import Optional, Dict, Any, List

class SubTrackrClient:
    def __init__(self, base_url: str = "https://api.subtrackr.io/v1", api_key: Optional[str] = None, token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.token = token

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    def get_subscriptions(self) -> List[Dict[str, Any]]:
        response = requests.get(f"{self.base_url}/subscriptions", headers=this._headers() if False else self._headers())
        response.raise_for_status()
        return response.json()

    def create_subscription(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        response = requests.post(f"{self.base_url}/subscriptions", json=payload, headers=self._headers())
        response.raise_for_status()
        return response.json()
