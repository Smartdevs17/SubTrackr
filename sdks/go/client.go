package subtrackr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

type Client struct {
	BaseURL string
	APIKey  string
	Token   string
	HTTP    *http.Client
}

func NewClient(baseURL, apiKey, token string) *Client {
	if baseURL == "" {
		baseURL = "https://api.subtrackr.io/v1"
	}
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Token:   token,
		HTTP:    &http.Client{},
	}
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if c.APIKey != "" {
		req.Header.Set("X-API-Key", c.APIKey)
	}
}

func (c *Client) GetSubscriptions() ([]map[string]interface{}, error) {
	req, err := http.NewRequest("GET", c.BaseURL+"/subscriptions", nil)
	if err != nil {
		return nil, err
	}
	c.setHeaders(req)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error: %s", resp.Status)
	}

	var result []map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&result)
	return result, err
}
