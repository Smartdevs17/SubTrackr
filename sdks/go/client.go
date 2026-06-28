package subtrackr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Client struct {
	authManager *AuthManager
	baseURL     string
	httpClient  *http.Client
}

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
		httpClient:  &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (c *Client) request(method string, endpoint string, body interface{}, out interface{}) error {
	var reqBody []byte
	var err error

	if body != nil {
		reqBody, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}

	url := fmt.Sprintf("%s%s", c.baseURL, endpoint)
	req, err := http.NewRequest(method, url, bytes.NewBuffer(reqBody))
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+c.authManager.GetToken())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var apiErrResp ApiErrorResponse
		if err := json.NewDecoder(resp.Body).Decode(&apiErrResp); err != nil {
			return &ApiError{Message: resp.Status, StatusCode: resp.StatusCode}
		}
		return &ApiError{Message: apiErrResp.Message, StatusCode: resp.StatusCode, Code: apiErrResp.Code}
	}

	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}

	return nil
}

func (c *Client) Initialize(admin string) error {
	return c.request("POST", "/initialize", map[string]string{"admin": admin}, nil)
}

func (c *Client) CreatePlan(req CreatePlanRequest) (int64, error) {
	var id int64
	err := c.request("POST", "/create_plan", req, &id)
	return id, err
}

func (c *Client) DeactivatePlan(merchant string, planID int64) error {
	return c.request("POST", "/deactivate_plan", map[string]interface{}{"merchant": merchant, "plan_id": planID}, nil)
}

func (c *Client) Subscribe(subscriber string, planID int64) (int64, error) {
	var id int64
	err := c.request("POST", "/subscribe", map[string]interface{}{"subscriber": subscriber, "plan_id": planID}, &id)
	return id, err
}

func (c *Client) CancelSubscription(subscriber string, subscriptionID int64) error {
	return c.request("POST", "/cancel_subscription", map[string]interface{}{"subscriber": subscriber, "subscription_id": subscriptionID}, nil)
}

func (c *Client) PauseSubscription(subscriber string, subscriptionID int64) error {
	return c.request("POST", "/pause_subscription", map[string]interface{}{"subscriber": subscriber, "subscription_id": subscriptionID}, nil)
}

func (c *Client) ResumeSubscription(subscriber string, subscriptionID int64) error {
	return c.request("POST", "/resume_subscription", map[string]interface{}{"subscriber": subscriber, "subscription_id": subscriptionID}, nil)
}

func (c *Client) ChargeSubscription(subscriptionID int64) error {
	return c.request("POST", "/charge_subscription", map[string]int64{"subscription_id": subscriptionID}, nil)
}

func (c *Client) RequestRefund(subscriptionID int64, amount int64) error {
	return c.request("POST", "/request_refund", map[string]int64{"subscription_id": subscriptionID, "amount": amount}, nil)
}

func (c *Client) ApproveRefund(subscriptionID int64) error {
	return c.request("POST", "/approve_refund", map[string]int64{"subscription_id": subscriptionID}, nil)
}

func (c *Client) RejectRefund(subscriptionID int64) error {
	return c.request("POST", "/reject_refund", map[string]int64{"subscription_id": subscriptionID}, nil)
}

func (c *Client) GetPlan(planID int64) (Plan, error) {
	var plan Plan
	err := c.request("POST", "/get_plan", map[string]int64{"plan_id": planID}, &plan)
	return plan, err
}

func (c *Client) GetSubscription(subscriptionID int64) (Subscription, error) {
	var subscription Subscription
	err := c.request("POST", "/get_subscription", map[string]int64{"subscription_id": subscriptionID}, &subscription)
	return subscription, err
}

func (c *Client) GetUserSubscriptions(subscriber string) ([]int64, error) {
	var ids []int64
	err := c.request("POST", "/get_user_subscriptions", map[string]string{"subscriber": subscriber}, &ids)
	return ids, err
}

func (c *Client) GetMerchantPlans(merchant string) ([]int64, error) {
	var ids []int64
	err := c.request("POST", "/get_merchant_plans", map[string]string{"merchant": merchant}, &ids)
	return ids, err
}

func (c *Client) GetPlanCount() (int64, error) {
	var count int64
	err := c.request("POST", "/get_plan_count", nil, &count)
	return count, err
}

func (c *Client) GetSubscriptionCount() (int64, error) {
	var count int64
	err := c.request("POST", "/get_subscription_count", nil, &count)
	return count, err
}

func (c *Client) GetSubscriptions() ([]Subscription, error) {
	var subs []Subscription
	err := c.request("GET", "/v1/subscriptions", nil, &subs)
	return subs, err
}

func (c *Client) CreateSubscription(sub Subscription) (Subscription, error) {
	var created Subscription
	err := c.request("POST", "/v1/subscriptions", sub, &created)
	return created, err
}

func (c *Client) GetWebhooks() ([]Webhook, error) {
	var hooks []Webhook
	err := c.request("GET", "/v1/webhooks", nil, &hooks)
	return hooks, err
}

func (c *Client) CreateWebhook(hook Webhook) (Webhook, error) {
	var created Webhook
	err := c.request("POST", "/v1/webhooks", hook, &created)
	return created, err
}
