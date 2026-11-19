package subtrackr

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	apiKey  string
	HTTP    *http.Client
}

func NewClient(apiKey, environment string) (*Client, error) {
	if apiKey == "" {
		return nil, &AuthenticationError{Message: "API Key is required to initialize the SDK"}
	}

	baseURL := "https://api.subtrackr.app"
	if environment == "sandbox" {
		baseURL = "https://sandbox.api.subtrackr.app"
	}

	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("X-API-Key", c.apiKey)
	}
}

func (c *Client) doRequest(method, path string, body interface{}, result interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(data)
	}

	fullURL := c.baseURL + path
	maxAttempts := 3

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if bodyReader != nil && attempt > 1 {
			data, _ := json.Marshal(body)
			bodyReader = bytes.NewReader(data)
		}

		req, err := http.NewRequest(method, fullURL, bodyReader)
		if err != nil {
			return err
		}
		c.setHeaders(req)

		resp, err := c.HTTP.Do(req)
		if err != nil {
			if attempt < maxAttempts {
				time.Sleep(time.Duration(attempt*10) * time.Millisecond)
				continue
			}
			return err
		}

		respBody, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()

		if readErr != nil {
			return readErr
		}

		if resp.StatusCode >= 500 && attempt < maxAttempts {
			time.Sleep(time.Duration(attempt*10) * time.Millisecond)
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			var errResp ApiErrorResponse
			_ = json.Unmarshal(respBody, &errResp)
			msg := errResp.Message
			if msg == "" {
				msg = http.StatusText(resp.StatusCode)
			}
			return &ApiError{
				Message:    msg,
				StatusCode: resp.StatusCode,
				Code:       errResp.Code,
			}
		}

		if result != nil && len(respBody) > 0 {
			if err := json.Unmarshal(respBody, result); err != nil {
				return err
			}
		}

		return nil
	}

	return fmt.Errorf("request failed after %d attempts", maxAttempts)
}

// ── Plans ───────────────────────────────────────────────────────────────────

func (c *Client) CreatePlan(req CreatePlanRequest) (int64, error) {
	var id int64
	err := c.doRequest(http.MethodPost, "/create_plan", req, &id)
	return id, err
}

func (c *Client) GetPlan(id int64) (Plan, error) {
	var plan Plan
	err := c.doRequest(http.MethodGet, fmt.Sprintf("/v1/plans/%d", id), nil, &plan)
	return plan, err
}

func (c *Client) GetPlanCount() (int64, error) {
	var count int64
	err := c.doRequest(http.MethodGet, "/v1/plans/count", nil, &count)
	return count, err
}

// ── Subscriptions ────────────────────────────────────────────────────────────

func (c *Client) PauseSubscription(merchant string, subscriptionID interface{}) error {
	req := map[string]interface{}{"merchant": merchant, "subscription_id": subscriptionID}
	return c.doRequest(http.MethodPost, "/pause_subscription", req, nil)
}

func (c *Client) ResumeSubscription(merchant string, subscriptionID interface{}) error {
	req := map[string]interface{}{"merchant": merchant, "subscription_id": subscriptionID}
	return c.doRequest(http.MethodPost, "/resume_subscription", req, nil)
}

func (c *Client) CancelSubscription(merchant string, subscriptionID interface{}) error {
	req := map[string]interface{}{"merchant": merchant, "subscription_id": subscriptionID}
	return c.doRequest(http.MethodPost, "/cancel_subscription", req, nil)
}

func (c *Client) ChargeSubscription(subscriptionID interface{}) error {
	req := map[string]interface{}{"subscription_id": subscriptionID}
	return c.doRequest(http.MethodPost, "/charge_subscription", req, nil)
}

func (c *Client) ApproveRefund(subscriptionID interface{}) error {
	req := map[string]interface{}{"subscription_id": subscriptionID}
	return c.doRequest(http.MethodPost, "/approve_refund", req, nil)
}

func (c *Client) RejectRefund(subscriptionID interface{}) error {
	req := map[string]interface{}{"subscription_id": subscriptionID}
	return c.doRequest(http.MethodPost, "/reject_refund", req, nil)
}

func (c *Client) ListSubscriptions(opts PageOptions) (Page[Subscription], error) {
	query := url.Values{}
	if opts.Limit > 0 {
		query.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Cursor != "" {
		query.Set("cursor", opts.Cursor)
	}

	path := "/v1/subscriptions"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}

	var page Page[Subscription]
	err := c.doRequest(http.MethodGet, path, nil, &page)
	return page, err
}

// ── Dunning ─────────────────────────────────────────────────────────────────

func (c *Client) CreateDunningEntry(req CreateDunningEntryRequest) (DunningEntry, error) {
	var entry DunningEntry
	err := c.doRequest(http.MethodPost, "/v1/dunning", req, &entry)
	return entry, err
}

func (c *Client) GetDunningEntry(id string) (DunningEntry, error) {
	var entry DunningEntry
	err := c.doRequest(http.MethodGet, "/v1/dunning/"+id, nil, &entry)
	return entry, err
}

func (c *Client) PauseDunning(id string) (DunningEntry, error) {
	var entry DunningEntry
	err := c.doRequest(http.MethodPost, "/v1/dunning/"+id+"/pause", nil, &entry)
	return entry, err
}

func (c *Client) ResolveDunning(id string) (DunningEntry, error) {
	var entry DunningEntry
	err := c.doRequest(http.MethodPost, "/v1/dunning/"+id+"/resolve", nil, &entry)
	return entry, err
}

// ── Invoices ────────────────────────────────────────────────────────────────

func (c *Client) GetInvoice(id string) (Invoice, error) {
	var invoice Invoice
	err := c.doRequest(http.MethodGet, "/v1/invoices/"+id, nil, &invoice)
	return invoice, err
}

// ── Usage ───────────────────────────────────────────────────────────────────

func (c *Client) IngestUsage(req UsageIngestRequest) (UsageRecord, error) {
	var record UsageRecord
	err := c.doRequest(http.MethodPost, "/v1/usage", req, &record)
	return record, err
}

func (c *Client) GetUsageSummary(subscriptionID interface{}, startTime, endTime int64) (UsageSummary, error) {
	query := url.Values{}
	query.Set("subscription_id", fmt.Sprintf("%v", subscriptionID))
	query.Set("start_time", strconv.FormatInt(startTime, 10))
	query.Set("end_time", strconv.FormatInt(endTime, 10))

	path := "/v1/usage/summary?" + query.Encode()
	var summary UsageSummary
	err := c.doRequest(http.MethodGet, path, nil, &summary)
	return summary, err
}

// ── Webhooks ────────────────────────────────────────────────────────────────

func (c *Client) CreateWebhook(req Webhook) (Webhook, error) {
	var wh Webhook
	err := c.doRequest(http.MethodPost, "/v1/webhooks", req, &wh)
	return wh, err
}

func (c *Client) VerifyWebhookSignature(req WebhookVerifyRequest) bool {
	if req.Signature == "" || req.Secret == "" {
		return false
	}

	mac := hmac.New(sha256.New, []byte(req.Secret))
	mac.Write(req.Payload)
	expectedSig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(strings.ToLower(req.Signature)), []byte(strings.ToLower(expectedSig)))
}
