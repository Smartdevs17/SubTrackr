# SubTrackr Go SDK

The official Go SDK for the SubTrackr API.

## Installation

```bash
go get github.com/subtrackr/subtrackr-go
```

## Quick Start

### 1. Initialize the Client

```go
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/subtrackr/subtrackr-go"
)

func main() {
	apiKey := os.Getenv("SUBTRACKR_API_KEY") // e.g., "sk_test_your_key"
	client := subtrackr.NewClient(apiKey)

	// Context for requests
	ctx := context.Background()

	// 2. List Subscriptions
	opts := &subtrackr.SubscriptionListOptions{
		Status: "active",
		Limit:  10,
	}
	
	resp, err := client.Subscriptions.List(ctx, opts)
	if err != nil {
		log.Fatalf("Error listing subscriptions: %v", err)
	}

	for _, sub := range resp.Data {
		fmt.Printf("Subscription: %s - $%.2f\n", sub.Name, sub.Price)
	}

	// 3. Create a Subscription
	newSub := &subtrackr.SubscriptionParams{
		Name:         "Netflix",
		Category:     "streaming",
		Price:        15.99,
		Currency:     "USD",
		BillingCycle: "monthly",
		StartDate:    "2024-01-01T00:00:00Z",
	}

	createdSub, err := client.Subscriptions.Create(ctx, newSub)
	if err != nil {
		log.Fatalf("Error creating subscription: %v", err)
	}
	fmt.Printf("Created subscription ID: %s\n", createdSub.ID)
}
```

## Requirements
- Go 1.18+
