# SubTrackr Python SDK

The official Python SDK for the SubTrackr API.

## Installation

```bash
pip install subtrackr
```

## Quick Start

### 1. Initialize the Client

```python
import os
import subtrackr

client = subtrackr.Client(
    api_key=os.environ.get("SUBTRACKR_API_KEY") # e.g., 'sk_test_your_key'
)
```

### 2. List Subscriptions

```python
def fetch_subscriptions():
    try:
        response = client.subscriptions.list(
            status="active",
            limit=10
        )
        for sub in response.data:
            print(f"Subscription: {sub.name} - ${sub.price}")
    except subtrackr.SubTrackrError as e:
        print(f"Error: {e.message}")

fetch_subscriptions()
```

### 3. Create a Subscription

```python
from datetime import datetime, timezone

def create_subscription():
    new_sub = client.subscriptions.create(
        name="Netflix",
        category="streaming",
        price=15.99,
        currency="USD",
        billing_cycle="monthly",
        start_date=datetime.now(timezone.utc).isoformat()
    )
    print(f"Created subscription: {new_sub.id}")

create_subscription()
```

## Requirements
- Python 3.8+
