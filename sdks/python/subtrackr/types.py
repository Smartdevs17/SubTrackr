from typing import List, Literal, TypedDict, Union

BillingInterval = Literal["Weekly", "Monthly", "Quarterly", "Yearly"]
SubscriptionStatus = Literal["Active", "Paused", "Cancelled", "PastDue"]


class Plan(TypedDict):
    id: int
    merchant: str
    name: str
    price: int
    token: str
    interval: BillingInterval
    active: bool
    subscriber_count: int
    created_at: int


class Subscription(TypedDict):
    id: Union[int, str]
    status: Union[SubscriptionStatus, str]

class Webhook(TypedDict):
    id: str
    url: str
    events: List[str]
