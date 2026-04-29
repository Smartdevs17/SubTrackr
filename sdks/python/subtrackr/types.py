from typing import TypedDict, Optional, List

class Subscription(TypedDict):
    id: str
    name: str
    price: float
    currency: str
    status: str

class Webhook(TypedDict):
    id: str
    url: str
    events: List[str]
