package subtrackr

type BillingInterval string
type SubscriptionStatus string

const (
	Weekly    BillingInterval = "Weekly"
	Monthly   BillingInterval = "Monthly"
	Quarterly BillingInterval = "Quarterly"
	Yearly    BillingInterval = "Yearly"
)

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

type Webhook struct {
	ID     string   `json:"id"`
	URL    string   `json:"url"`
	Events []string `json:"events"`
}

type ApiErrorResponse struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

type CreatePlanRequest struct {
	Merchant string          `json:"merchant"`
	Name     string          `json:"name"`
	Price    int64           `json:"price"`
	Token    string          `json:"token"`
	Interval BillingInterval `json:"interval"`
}
