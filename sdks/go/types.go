// Package subtrackr provides a Go client for the SubTrackr subscription management API.
//
// # Quick start
//
//	client, err := subtrackr.NewClient("your-api-key", "sandbox")
//	if err != nil { log.Fatal(err) }
//
//	sub, err := client.GetSubscription(42)
package subtrackr

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations
// ─────────────────────────────────────────────────────────────────────────────

// BillingInterval represents how often a subscription is billed.
type BillingInterval string

const (
	Weekly    BillingInterval = "Weekly"
	Monthly   BillingInterval = "Monthly"
	Quarterly BillingInterval = "Quarterly"
	Yearly    BillingInterval = "Yearly"
)

// SubscriptionStatus represents the current state of a subscription.
type SubscriptionStatus string

const (
	StatusActive    SubscriptionStatus = "Active"
	StatusPaused    SubscriptionStatus = "Paused"
	StatusCancelled SubscriptionStatus = "Cancelled"
	StatusPastDue   SubscriptionStatus = "PastDue"
)

// DunningStatus represents the current dunning state.
type DunningStatus string

const (
	DunningActive    DunningStatus = "Active"
	DunningPaused    DunningStatus = "Paused"
	DunningResolved  DunningStatus = "Resolved"
	DunningExhausted DunningStatus = "Exhausted"
)

// ─────────────────────────────────────────────────────────────────────────────
// Core domain types
// ─────────────────────────────────────────────────────────────────────────────

// Plan represents a subscription plan.
type Plan struct {
	ID              int64           `json:"id"`
	Merchant        string          `json:"merchant"`
	Name            string          `json:"name"`
	Price           int64           `json:"price"`
	Token           string          `json:"token"`
	Interval        BillingInterval `json:"interval"`
	Active          bool            `json:"active"`
	SubscriberCount int             `json:"subscriber_count"`
	CreatedAt       int64           `json:"created_at"`
}

// Subscription represents a customer subscription.
type Subscription struct {
	ID                    interface{} `json:"id"`
	Name                  string      `json:"name,omitempty"`
	Price                 float64     `json:"price,omitempty"`
	Currency              string      `json:"currency,omitempty"`
	PlanID                int64       `json:"plan_id,omitempty"`
	Subscriber            string      `json:"subscriber,omitempty"`
	Status                string      `json:"status"`
	StartedAt             int64       `json:"started_at,omitempty"`
	LastChargedAt         int64       `json:"last_charged_at,omitempty"`
	NextChargeAt          int64       `json:"next_charge_at,omitempty"`
	TotalPaid             int64       `json:"total_paid,omitempty"`
	RefundRequestedAmount int64       `json:"refund_requested_amount,omitempty"`
}

// Webhook represents a registered webhook endpoint.
type Webhook struct {
	ID     string   `json:"id"`
	URL    string   `json:"url"`
	Events []string `json:"events"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Dunning
// ─────────────────────────────────────────────────────────────────────────────

// DunningEntry represents a dunning management record for a failing subscription.
type DunningEntry struct {
	ID             string        `json:"id"`
	SubscriptionID interface{}   `json:"subscription_id"`
	Status         DunningStatus `json:"status"`
	AttemptCount   int           `json:"attempt_count"`
	MaxAttempts    int           `json:"max_attempts"`
	NextAttemptAt  int64         `json:"next_attempt_at,omitempty"`
	LastAttemptAt  int64         `json:"last_attempt_at,omitempty"`
	FailureReason  string        `json:"failure_reason,omitempty"`
	CreatedAt      int64         `json:"created_at"`
	UpdatedAt      int64         `json:"updated_at"`
}

// CreateDunningEntryRequest is used to enroll a subscription in dunning.
type CreateDunningEntryRequest struct {
	SubscriptionID interface{} `json:"subscription_id"`
	MaxAttempts    int         `json:"max_attempts,omitempty"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Billing
// ─────────────────────────────────────────────────────────────────────────────

// Invoice represents a billing invoice.
type Invoice struct {
	ID             string  `json:"id"`
	SubscriptionID interface{} `json:"subscription_id"`
	Amount         float64 `json:"amount"`
	Currency       string  `json:"currency"`
	Status         string  `json:"status"`
	IssuedAt       int64   `json:"issued_at"`
	DueAt          int64   `json:"due_at,omitempty"`
	PaidAt         int64   `json:"paid_at,omitempty"`
}

// BillingRecord is a summary of a billing charge.
type BillingRecord struct {
	ID             string  `json:"id"`
	SubscriptionID interface{} `json:"subscription_id"`
	Amount         float64 `json:"amount"`
	Currency       string  `json:"currency"`
	ChargedAt      int64   `json:"charged_at"`
	Success        bool    `json:"success"`
	FailureReason  string  `json:"failure_reason,omitempty"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage metering
// ─────────────────────────────────────────────────────────────────────────────

// UsageRecord represents a metered usage event.
type UsageRecord struct {
	ID             string  `json:"id"`
	SubscriptionID interface{} `json:"subscription_id"`
	MetricName     string  `json:"metric_name"`
	Quantity       float64 `json:"quantity"`
	Timestamp      int64   `json:"timestamp"`
}

// UsageIngestRequest is used to record usage for a subscription.
type UsageIngestRequest struct {
	SubscriptionID interface{} `json:"subscription_id"`
	MetricName     string      `json:"metric_name"`
	Quantity       float64     `json:"quantity"`
	// Timestamp is optional; server uses current time if zero.
	Timestamp int64 `json:"timestamp,omitempty"`
}

// UsageSummary aggregates usage for a subscription over a period.
type UsageSummary struct {
	SubscriptionID interface{}        `json:"subscription_id"`
	PeriodStart    int64              `json:"period_start"`
	PeriodEnd      int64              `json:"period_end"`
	Metrics        map[string]float64 `json:"metrics"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook verification
// ─────────────────────────────────────────────────────────────────────────────

// WebhookVerifyRequest holds a raw webhook payload and its HMAC-SHA256 signature.
type WebhookVerifyRequest struct {
	Payload   []byte
	Signature string
	Secret    string
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

// PageOptions controls cursor-based pagination.
type PageOptions struct {
	// Cursor is the opaque pagination token returned by the previous page.
	Cursor string `json:"cursor,omitempty"`
	// Limit is the maximum number of records to return (default: 50, max: 200).
	Limit int `json:"limit,omitempty"`
}

// Page wraps a paginated result.
type Page[T any] struct {
	Items   []T    `json:"items"`
	Cursor  string `json:"cursor,omitempty"`
	HasMore bool   `json:"has_more"`
	Total   int    `json:"total,omitempty"`
}

// ─────────────────────────────────────────────────────────────────────────────
// API wire types
// ─────────────────────────────────────────────────────────────────────────────

// ApiErrorResponse is the raw error body returned by the API.
type ApiErrorResponse struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

// CreatePlanRequest is used to create a new subscription plan.
type CreatePlanRequest struct {
	Merchant string          `json:"merchant"`
	Name     string          `json:"name"`
	Price    int64           `json:"price"`
	Token    string          `json:"token"`
	Interval BillingInterval `json:"interval"`
}
