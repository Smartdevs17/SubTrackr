# SubTrackr SDK Documentation

Welcome to the SubTrackr SDK documentation. SubTrackr provides official SDKs in multiple languages to smoothly integrate with our subscription lifecycle APIs.

## Supported Languages

- [JavaScript/TypeScript](#javascript-typescript)
- [Python](#python)
- [Go](#go)

---

## JavaScript / TypeScript

### Installation
You can build the JS SDK into your project or install it as a package `npm install @subtrackr/sdk`.

### Basic Usage
```typescript
import { SubTrackrClient } from '@subtrackr/sdk';

const client = new SubTrackrClient({
  apiKey: 'sk_test_12345',
  environment: 'sandbox', // Use 'production' for live systems
});

async function run() {
  const subs = await client.getSubscriptions();
  console.log('Subscriptions:', subs);
}
run();
```

---

## Python

### Installation
```bash
pip install subtrackr-sdk
```

### Basic Usage
```python
from subtrackr import SubTrackrClient

client = SubTrackrClient(
    api_key="sk_test_12345", 
    environment="sandbox"
)

subs = client.get_subscriptions()
for sub in subs:
    print(sub['name'], sub['price'])
```

---

## Go

### Installation
```bash
go get github.com/Smartdevs17/SubTrackr/sdks/go
```

### Basic Usage
```go
package main

import (
	"fmt"
	"github.com/Smartdevs17/SubTrackr/sdks/go"
)

func main() {
	client, err := subtrackr.NewClient("sk_test_12345", "sandbox")
	if err != nil {
		panic(err)
	}

	subs, err := client.GetSubscriptions()
	if err != nil {
		panic(err)
	}

	fmt.Println(subs)
}
```
