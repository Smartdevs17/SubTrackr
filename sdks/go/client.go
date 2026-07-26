// Package subtrackr provides a Go client for the SubTrackr subscription management API.
package subtrackr

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const (
	defaultTimeout    = 30 * time.Second
	maxRetries        = 3
	baseBackoff       = 200 * time.Millisecond
	backoffMultiplier = 2.0
	maxBackoff        = 10 * time.Second
)

// Client is the SubTrackr API client.
//
// Create one with NewClient and reuse it across requests — it is safe for
// concurrent use.
type Client struct {
	authManager *AuthManager
	baseURL     string
	httpClient  *http.Client
}

// NewClient creates a new SubTrackr client.
//
// environment must be "production" or "sandbox".
//
//	client, err := subtrackr.NewClient(os.Getenv("SUBTRACKR_API_KEY"), "sandbox")
func NewClient(apiKey string, environment string) (*Client, error) {
	auth, err := NewAuthManager(apiKey)
	if err != nil {
		return nil, err
	}

	baseURL := "https://api.subtrackr.app"
	if environment == "sandbox" {
		baseURL = "https://sandbox.api.subtrackr.app"
	}

	return &Client{
		authManager: auth,
		baseURL:     baseURL,
		httpClient:  &http.Client{Timeout: defaultTimeout},
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal transport helpers
// ─────────────────────────────────────────────────────────────────────────────

// isTransient returns true for status codes that warrant a retry.
func isTransient(statusCode int) bool {
	return statusCode == http.StatusTooManyRequests ||
		statusCode == http.StatusServiceUnavailable ||
		statusCode == http.StatusGatewayTimeout ||
		statusCode == http.StatusBadGateway
}

// request executes an HTTP request and decodes the JSON response into out.
// It automatically retries on transient failures with exponential backoff.
func (c *Client) request(method, endpoint string, body, out interface{}) error {
	return c.requestWithQuery(method, endpoint, body, out, nil)
}

func (c *Client) requestWithQuery(method, endpoint string, body, out interface{}, query url.Values) error {
	var reqBody []byte
	var err error
	if body != nil {
		reqBody, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}

	rawURL := fmt.Sprintf("%s%s", c.baseURL, endpoint)
	if len(query) > 0 {
		rawURL += "?" + query.Encode()
	}

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			sleep := time.Duration(float64(baseBackoff) * math.Pow(backoffMultiplier, float64(attempt-1)))
			if sleep > maxBackoff {
				sleep = maxBackoff
			}
			time.Sleep(sleep)
		}

		req, err := http.NewRequest(method, rawURL, bytes.NewBuffer(reqBody))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+c.authManager.GetToken())
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue // network error — retry
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 400 {
			var apiErrResp ApiErrorResponse
			_ = json.NewDecoder(resp.Body).Decode(&apiErrResp)
			apiErr := &ApiError{Message: apiErrResp.Message, StatusCode: resp.StatusCode, Code: apiErrResp.Code}
			if apiErrResp.Message == "" {
				apiErr.Message = resp.Status
			}
			if isTransient(resp.StatusCode) && attempt < maxRetries {
				lastErr = apiErr
				continue
			}
			return apiErr
		}

		if out != nil {
			return json.NewDecoder(resp.Body).Decode(out)
		}
		return nil
	}
	return lastErr
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract / on-chain endpoints
// ─────────────────────────────────────────────────────────────────────────────

// Initialize sets the contract admin.
func (c *Client) Initialize(admin string) error {
	return c.request(http.MethodPost, "/initialize", map[string]string{"admin": admin}, nil)
}

// CreatePlan creates a new subscription plan and returns its ID.
func (c *Client) CreatePlan(req CreatePlanRequest) (int64, error) {
	var id int64
	err := c.request(http.MethodPost, "/create_plan", req, &id)
	return id, err
}

// DeactivatePlan deactivates an existing plan.
func (c *Client) DeactivatePlan(merchant string, planID int64) error {
	return c.request(http.MethodPost, "/deactivate_plan", map[string]interface{}{
		"merchant": merchant, "plan_id": planID,
	}, nil)
}

// Subscribe creates a subscription for a subscriber on a plan and returns the subscription ID.
func (c *Client) Subscribe(subscriber string, planID int64) (int64, error) {
	var id int64
	err := c.request(http.MethodPost, "/subscribe", map[string]interface{}{
		"subscriber": subscriber, "plan_id": planID,
	}, &id)
	return id, err
}

// CancelSubscription cancels a subscription.
func (c *Client) CancelSubscription(subscriber string, subscriptionID int64) error {
	return c.request(http.MethodPost, "/cancel_subscription", map[string]interface{}{
		"subscriber": subscriber, "subscription_id": subscriptionID,
	}, nil)
}

// PauseSubscription pauses an active subscription.
func (c *Client) PauseSubscription(subscriber string, subscriptionID int64) error {
	return c.request(http.MethodPost, "/pause_subscription", map[string]interface{}{
		"subscriber": subscriber, "subscription_id": subscriptionID,
	}, nil)
}

// ResumeSubscription reactivates a paused subscription.
func (c *Client) ResumeSubscription(subscriber string, subscriptionID int64) error {
	return c.request(http.MethodPost, "/resume_subscription", map[string]interface{}{
		"subscriber": subscriber, "subscription_id": subscriptionID,
	}, nil)
}

// ChargeSubscription triggers an immediate charge for a subscription.
func (c *Client) ChargeSubscription(subscriptionID int64) error {
	return c.request(http.MethodPost, "/charge_subscription", map[string]int64{
		"subscription_id": subscriptionID,
	}, nil)
}

// RequestRefund requests a refund for a subscription charge.
func (c *Client) RequestRefund(subscriptionID int64, amount int64) error {
	return c.request(http.MethodPost, "/request_refund", map[string]int64{
		"subscription_id": subscriptionID, "amount": amount,
	}, nil)
}

// ApproveRefund approves a pending refund request.
func (c *Client) ApproveRefund(subscriptionID int64) error {
	return c.request(http.MethodPost, "/approve_refund", map[string]int64{
		"subscription_id": subscriptionID,
	}, nil)
}

// RejectRefund rejects a pending refund request.
func (c *Client) RejectRefund(subscriptionID int64) error {
	return c.request(http.MethodPost, "/reject_refund", map[string]int64{
		"subscription_id": subscriptionID,
	}, nil)
}

// GetPlan fetches a plan by ID.
func (c *Client) GetPlan(planID int64) (Plan, error) {
	var plan Plan
	err := c.request(http.MethodPost, "/get_plan", map[string]int64{"plan_id": planID}, &plan)
	return plan, err
}

// GetSubscription fetches a subscription by ID.
func (c *Client) GetSubscription(subscriptionID int64) (Subscription, error) {
	var sub Subscription
	err := c.request(http.MethodPost, "/get_subscription", map[string]int64{
		"subscription_id": subscriptionID,
	}, &sub)
	return sub, err
}

// GetUserSubscriptions returns all subscription IDs for a subscriber.
func (c *Client) GetUserSubscriptions(subscriber string) ([]int64, error) {
	var ids []int64
	err := c.request(http.MethodPost, "/get_user_subscriptions", map[string]string{"subscriber": subscriber}, &ids)
	return ids, err
}

// GetMerchantPlans returns all plan IDs for a merchant.
func (c *Client) GetMerchantPlans(merchant string) ([]int64, error) {
	var ids []int64
	err := c.request(http.MethodPost, "/get_merchant_plans", map[string]string{"merchant": merchant}, &ids)
	return ids, err
}

// GetPlanCount returns the total number of plans.
func (c *Client) GetPlanCount() (int64, error) {
	var count int64
	err := c.request(http.MethodPost, "/get_plan_count", nil, &count)
	return count, err
}

// GetSubscriptionCount returns the total number of subscriptions.
func (c *Client) GetSubscriptionCount() (int64, error) {
	var count int64
	err := c.request(http.MethodPost, "/get_subscription_count", nil, &count)
	return count, err
}

// ─────────────────────────────────────────────────────────────────────────────
// REST subscription endpoints
// ─────────────────────────────────────────────────────────────────────────────

// ListSubscriptions returns a paginated page of subscriptions.
//
//	page, err := client.ListSubscriptions(subtrackr.PageOptions{Limit: 50})
func (c *Client) ListSubscriptions(opts PageOptions) (Page[Subscription], error) {
	var page Page[Subscription]
	q := pageQuery(opts)
	err := c.requestWithQuery(http.MethodGet, "/v1/subscriptions", nil, &page, q)
	return page, err
}

// CreateSubscription creates a new subscription via the REST API.
func (c *Client) CreateSubscription(sub Subscription) (Subscription, error) {
	var created Subscription
	err := c.request(http.MethodPost, "/v1/subscriptions", sub, &created)
	return created, err
}

// UpdateSubscription updates fields on an existing subscription.
func (c *Client) UpdateSubscription(id interface{}, updates map[string]interface{}) (Subscription, error) {
	var updated Subscription
	err := c.request(http.MethodPatch, fmt.Sprintf("/v1/subscriptions/%v", id), updates, &updated)
	return updated, err
}

// ─────────────────────────────────────────────────────────────────────────────
// Dunning endpoints
// ─────────────────────────────────────────────────────────────────────────────

// ListDunningEntries returns a paginated list of dunning entries.
func (c *Client) ListDunningEntries(opts PageOptions) (Page[DunningEntry], error) {
	var page Page[DunningEntry]
	err := c.requestWithQuery(http.MethodGet, "/v1/dunning", nil, &page, pageQuery(opts))
	return page, err
}

// GetDunningEntry fetches a dunning entry by ID.
func (c *Client) GetDunningEntry(id string) (DunningEntry, error) {
	var entry DunningEntry
	err := c.request(http.MethodGet, "/v1/dunning/"+id, nil, &entry)
	return entry, err
}

// CreateDunningEntry enrolls a subscription in the dunning workflow.
func (c *Client) CreateDunningEntry(req CreateDunningEntryRequest) (DunningEntry, error) {
	var entry DunningEntry
	err := c.request(http.MethodPost, "/v1/dunning", req, &entry)
	return entry, err
}

// PauseDunning pauses retry attempts for a dunning entry.
func (c *Client) PauseDunning(id string) (DunningEntry, error) {
	var entry DunningEntry
	err := c.request(http.MethodPost, "/v1/dunning/"+id+"/pause", nil, &entry)
	return entry, err
}

// ResolveDunning marks a dunning entry as resolved (payment recovered).
func (c *Client) ResolveDunning(id string) (DunningEntry, error) {
	var entry DunningEntry
	err := c.request(http.MethodPost, "/v1/dunning/"+id+"/resolve", nil, &entry)
	return entry, err
}

// ─────────────────────────────────────────────────────────────────────────────
// Billing endpoints
// ─────────────────────────────────────────────────────────────────────────────

// ListInvoices returns a paginated list of invoices for a subscription.
func (c *Client) ListInvoices(subscriptionID interface{}, opts PageOptions) (Page[Invoice], error) {
	var page Page[Invoice]
	q := pageQuery(opts)
	q.Set("subscription_id", fmt.Sprintf("%v", subscriptionID))
	err := c.requestWithQuery(http.MethodGet, "/v1/billing/invoices", nil, &page, q)
	return page, err
}

// GetInvoice fetches a single invoice by ID.
func (c *Client) GetInvoice(id string) (Invoice, error) {
	var inv Invoice
	err := c.request(http.MethodGet, "/v1/billing/invoices/"+id, nil, &inv)
	return inv, err
}

// ListBillingHistory returns a paginated list of billing records.
func (c *Client) ListBillingHistory(subscriptionID interface{}, opts PageOptions) (Page[BillingRecord], error) {
	var page Page[BillingRecord]
	q := pageQuery(opts)
	q.Set("subscription_id", fmt.Sprintf("%v", subscriptionID))
	err := c.requestWithQuery(http.MethodGet, "/v1/billing/history", nil, &page, q)
	return page, err
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage metering endpoints
// ─────────────────────────────────────────────────────────────────────────────

// IngestUsage records metered usage for a subscription.
func (c *Client) IngestUsage(req UsageIngestRequest) (UsageRecord, error) {
	var record UsageRecord
	err := c.request(http.MethodPost, "/v1/usage", req, &record)
	return record, err
}

// GetUsageSummary returns an aggregated usage summary for a subscription.
func (c *Client) GetUsageSummary(subscriptionID interface{}, from, to int64) (UsageSummary, error) {
	var summary UsageSummary
	q := url.Values{}
	q.Set("subscription_id", fmt.Sprintf("%v", subscriptionID))
	q.Set("from", strconv.FormatInt(from, 10))
	q.Set("to", strconv.FormatInt(to, 10))
	err := c.requestWithQuery(http.MethodGet, "/v1/usage/summary", nil, &summary, q)
	return summary, err
}

// ListUsageRecords returns a paginated list of raw usage records.
func (c *Client) ListUsageRecords(subscriptionID interface{}, opts PageOptions) (Page[UsageRecord], error) {
	var page Page[UsageRecord]
	q := pageQuery(opts)
	q.Set("subscription_id", fmt.Sprintf("%v", subscriptionID))
	err := c.requestWithQuery(http.MethodGet, "/v1/usage", nil, &page, q)
	return page, err
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook endpoints & verification
// ─────────────────────────────────────────────────────────────────────────────

// ListWebhooks returns all registered webhooks.
func (c *Client) ListWebhooks() ([]Webhook, error) {
	var hooks []Webhook
	err := c.request(http.MethodGet, "/v1/webhooks", nil, &hooks)
	return hooks, err
}

// CreateWebhook registers a new webhook endpoint.
func (c *Client) CreateWebhook(hook Webhook) (Webhook, error) {
	var created Webhook
	err := c.request(http.MethodPost, "/v1/webhooks", hook, &created)
	return created, err
}

// DeleteWebhook removes a webhook by ID.
func (c *Client) DeleteWebhook(id string) error {
	return c.request(http.MethodDelete, "/v1/webhooks/"+id, nil, nil)
}

// VerifyWebhookSignature validates the HMAC-SHA256 signature of an incoming
// webhook payload.  Returns true when the signature is authentic.
//
//	body, _ := io.ReadAll(r.Body)
//	sig := r.Header.Get("X-SubTrackr-Signature")
//	ok := client.VerifyWebhookSignature(subtrackr.WebhookVerifyRequest{
//	    Payload:   body,
//	    Signature: sig,
//	    Secret:    os.Getenv("WEBHOOK_SECRET"),
//	})
func (c *Client) VerifyWebhookSignature(req WebhookVerifyRequest) bool {
	mac := hmac.New(sha256.New, []byte(req.Secret))
	mac.Write(req.Payload)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(req.Signature))
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal pagination helper
// ─────────────────────────────────────────────────────────────────────────────

func pageQuery(opts PageOptions) url.Values {
	q := url.Values{}
	if opts.Cursor != "" {
		q.Set("cursor", opts.Cursor)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	return q
}
