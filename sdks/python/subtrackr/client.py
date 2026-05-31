import requests
from typing import List, Dict, Any, Optional
from .auth import AuthManager
from .errors import ApiError
from .types import Plan, Subscription, Webhook

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

    def initialize(self, admin: str) -> None:
        return self._request("POST", "/initialize", json={"admin": admin})

    def create_plan(self, merchant: str, name: str, price: int, token: str, interval: str) -> int:
        return self._request(
            "POST",
            "/create_plan",
            json={
                "merchant": merchant,
                "name": name,
                "price": price,
                "token": token,
                "interval": interval,
            },
        )

    def deactivate_plan(self, merchant: str, plan_id: int) -> None:
        return self._request("POST", "/deactivate_plan", json={"merchant": merchant, "plan_id": plan_id})

    def subscribe(self, subscriber: str, plan_id: int) -> int:
        return self._request("POST", "/subscribe", json={"subscriber": subscriber, "plan_id": plan_id})

    def cancel_subscription(self, subscriber: str, subscription_id: int) -> None:
        return self._request(
            "POST",
            "/cancel_subscription",
            json={"subscriber": subscriber, "subscription_id": subscription_id},
        )

    def pause_subscription(self, subscriber: str, subscription_id: int) -> None:
        return self._request(
            "POST",
            "/pause_subscription",
            json={"subscriber": subscriber, "subscription_id": subscription_id},
        )

    def resume_subscription(self, subscriber: str, subscription_id: int) -> None:
        return self._request(
            "POST",
            "/resume_subscription",
            json={"subscriber": subscriber, "subscription_id": subscription_id},
        )

    def charge_subscription(self, subscription_id: int) -> None:
        return self._request("POST", "/charge_subscription", json={"subscription_id": subscription_id})

    def request_refund(self, subscription_id: int, amount: int) -> None:
        return self._request(
            "POST",
            "/request_refund",
            json={"subscription_id": subscription_id, "amount": amount},
        )

    def approve_refund(self, subscription_id: int) -> None:
        return self._request("POST", "/approve_refund", json={"subscription_id": subscription_id})

    def reject_refund(self, subscription_id: int) -> None:
        return self._request("POST", "/reject_refund", json={"subscription_id": subscription_id})

    def get_plan(self, plan_id: int) -> Plan:
        return self._request("POST", "/get_plan", json={"plan_id": plan_id})

    def get_subscription(self, subscription_id: int) -> Subscription:
        return self._request("POST", "/get_subscription", json={"subscription_id": subscription_id})

    def get_user_subscriptions(self, subscriber: str) -> List[int]:
        return self._request("POST", "/get_user_subscriptions", json={"subscriber": subscriber})

    def get_merchant_plans(self, merchant: str) -> List[int]:
        return self._request("POST", "/get_merchant_plans", json={"merchant": merchant})

    def get_plan_count(self) -> int:
        return self._request("POST", "/get_plan_count")

    def get_subscription_count(self) -> int:
        return self._request("POST", "/get_subscription_count")

    def get_subscriptions(self) -> List[Subscription]:
        return self._request("GET", "/v1/subscriptions")

    def create_subscription(self, data: Dict[str, Any]) -> Subscription:
        return self._request("POST", "/v1/subscriptions", json=data)

    def get_webhooks(self) -> List[Webhook]:
        return self._request("GET", "/v1/webhooks")

    def create_webhook(self, data: Dict[str, Any]) -> Webhook:
        return self._request("POST", "/v1/webhooks", json=data)
