package subtrackr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
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
