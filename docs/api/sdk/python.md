# Python SDK Examples

## Installation

```bash
pip install subtrackr-sdk
```

## Initialisation

```python
import os
from subtrackr import SubTrackr

client = SubTrackr(
    api_key=os.environ["SUBTRACKR_API_KEY"],
    # optional: use sandbox for testing
    base_url="https://sandbox.subtrackr.io/v1",
)
```

---

## Subscriptions

### Create a subscription

```python
from datetime import datetime, timezone

subscription = client.subscriptions.create(
    customer_id="cus_xyz789",
    plan_id="plan_monthly_pro",
    trial_end=datetime(2025, 3, 1, tzinfo=timezone.utc),
)

print(subscription.id)      # sub_abc123
print(subscription.status)  # trialing
```

### List subscriptions

```python
page = client.subscriptions.list(status="active", page=1, limit=20)

for sub in page.data:
    print(f"{sub.id} — {sub.status}")

# Auto-paginate all active subscriptions
for sub in client.subscriptions.iter_all(status="active"):
    print(sub.id)
```

### Cancel a subscription

```python
# Cancel at period end (default)
client.subscriptions.cancel("sub_abc123", reason="Customer requested")

# Cancel immediately
client.subscriptions.cancel("sub_abc123", immediately=True)
```

### Pause and resume

```python
from datetime import datetime, timezone

client.subscriptions.pause(
    "sub_abc123",
    resume_at=datetime(2025, 6, 1, tzinfo=timezone.utc),
)

client.subscriptions.resume("sub_abc123")
```

---

## Plans

```python
plan = client.plans.create(
    name="Pro Monthly",
    price=29.99,
    currency="USD",
    billing_cycle="monthly",
    trial_days=14,
    features=["Unlimited projects", "Priority support"],
)

plans = client.plans.list(active=True)
```

---

## Customers

```python
customer = client.customers.create(
    email="jane@example.com",
    name="Jane Doe",
    metadata={"external_id": "user_12345"},
)

retrieved = client.customers.get(customer.id)
```

---

## Webhooks

```python
import hmac, hashlib

endpoint = client.webhooks.create(
    url="https://example.com/webhooks/subtrackr",
    events=["subscription.created", "subscription.cancelled", "invoice.paid"],
)

# Store endpoint.signing_secret securely — only returned on creation
SIGNING_SECRET = endpoint.signing_secret

def verify_webhook(payload: bytes, signature: str) -> dict | None:
    """Verify and parse an incoming webhook payload."""
    expected = hmac.new(
        SIGNING_SECRET.encode(), payload, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return None
    import json
    return json.loads(payload)

# Flask example
from flask import Flask, request, abort
app = Flask(__name__)

@app.post("/webhooks/subtrackr")
def handle_webhook():
    sig = request.headers.get("Subtrackr-Signature", "")
    event = verify_webhook(request.get_data(), sig)
    if event is None:
        abort(400)

    if event["type"] == "subscription.created":
        print("New subscription:", event["data"]["id"])
    elif event["type"] == "invoice.paid":
        print("Invoice paid:", event["data"]["amount"])

    return {"received": True}
```

---

## Error handling

```python
from subtrackr.exceptions import SubTrackrError, NotFoundError

try:
    client.subscriptions.get("sub_does_not_exist")
except NotFoundError as e:
    print(e.code)     # subscription_not_found
    print(e.message)  # No subscription with id ...
    print(e.status)   # 404
except SubTrackrError as e:
    print("API error:", e)
```
