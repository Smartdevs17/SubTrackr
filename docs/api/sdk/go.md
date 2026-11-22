# Go SDK Examples

## Installation

```bash
go get github.com/subtrackr/subtrackr-go
```

## Initialisation

```go
package main

import (
    "os"
    "github.com/subtrackr/subtrackr-go"
)

func main() {
    client := subtrackr.New(subtrackr.Config{
        APIKey:  os.Getenv("SUBTRACKR_API_KEY"),
        // optional: use sandbox for testing
        BaseURL: "https://sandbox.subtrackr.io/v1",
    })
}
```

---

## Subscriptions

### Create a subscription

```go
import (
    "context"
    "time"
    "github.com/subtrackr/subtrackr-go"
)

trialEnd := time.Date(2025, 3, 1, 0, 0, 0, 0, time.UTC)

sub, err := client.Subscriptions.Create(context.Background(), subtrackr.CreateSubscriptionParams{
    CustomerID: "cus_xyz789",
    PlanID:     "plan_monthly_pro",
    TrialEnd:   &trialEnd,
})
if err != nil {
    log.Fatal(err)
}

fmt.Println(sub.ID)     // sub_abc123
fmt.Println(sub.Status) // trialing
```

### List subscriptions

```go
page, err := client.Subscriptions.List(context.Background(), subtrackr.ListSubscriptionsParams{
    Status: subtrackr.StatusActive,
    Page:   1,
    Limit:  20,
})
if err != nil {
    log.Fatal(err)
}

for _, s := range page.Data {
    fmt.Printf("%s — %s\n", s.ID, s.Status)
}
```

### Cancel a subscription

```go
// Cancel at period end
cancelled, err := client.Subscriptions.Cancel(context.Background(), "sub_abc123",
    subtrackr.CancelParams{
        Immediately: false,
        Reason:      "Customer requested",
    })

// Cancel immediately
cancelled, err := client.Subscriptions.Cancel(context.Background(), "sub_abc123",
    subtrackr.CancelParams{Immediately: true})
```

### Pause and resume

```go
resumeAt := time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC)

_, err = client.Subscriptions.Pause(context.Background(), "sub_abc123",
    subtrackr.PauseParams{ResumeAt: &resumeAt})

_, err = client.Subscriptions.Resume(context.Background(), "sub_abc123")
```

---

## Plans

```go
plan, err := client.Plans.Create(context.Background(), subtrackr.CreatePlanParams{
    Name:         "Pro Monthly",
    Price:        29.99,
    Currency:     "USD",
    BillingCycle: subtrackr.BillingCycleMonthly,
    TrialDays:    14,
    Features:     []string{"Unlimited projects", "Priority support"},
})

plans, err := client.Plans.List(context.Background(), subtrackr.ListPlansParams{Active: true})
```

---

## Customers

```go
customer, err := client.Customers.Create(context.Background(), subtrackr.CreateCustomerParams{
    Email:    "jane@example.com",
    Name:     "Jane Doe",
    Metadata: map[string]interface{}{"externalId": "user_12345"},
})

retrieved, err := client.Customers.Get(context.Background(), customer.ID)
```

---

## Webhooks

```go
import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "net/http"
)

endpoint, err := client.Webhooks.Create(context.Background(), subtrackr.CreateWebhookParams{
    URL: "https://example.com/webhooks/subtrackr",
    Events: []string{
        "subscription.created",
        "subscription.cancelled",
        "invoice.paid",
    },
})
// Store endpoint.SigningSecret securely — only returned on creation
signingSecret := endpoint.SigningSecret

// HTTP handler to verify webhook signatures
func WebhookHandler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    sig := r.Header.Get("Subtrackr-Signature")

    mac := hmac.New(sha256.New, []byte(signingSecret))
    mac.Write(body)
    expected := hex.EncodeToString(mac.Sum(nil))

    if !hmac.Equal([]byte(expected), []byte(sig)) {
        http.Error(w, "Invalid signature", http.StatusBadRequest)
        return
    }

    var event subtrackr.WebhookEvent
    if err := json.NewDecoder(bytes.NewReader(body)).Decode(&event); err != nil {
        http.Error(w, "Bad payload", http.StatusBadRequest)
        return
    }

    switch event.Type {
    case "subscription.created":
        log.Printf("New subscription: %s", event.Data["id"])
    case "invoice.paid":
        log.Printf("Invoice paid: %v", event.Data["amount"])
    }

    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]bool{"received": true})
}
```

---

## Error handling

```go
import "github.com/subtrackr/subtrackr-go/errors"

_, err := client.Subscriptions.Get(context.Background(), "sub_does_not_exist")
if err != nil {
    if apiErr, ok := err.(*errors.APIError); ok {
        fmt.Println(apiErr.Code)    // subscription_not_found
        fmt.Println(apiErr.Message) // No subscription with id ...
        fmt.Println(apiErr.Status)  // 404
    }
}
```
