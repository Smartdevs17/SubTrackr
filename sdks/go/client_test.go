package subtrackr

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

func newTestClient(t *testing.T, serverURL string) *Client {
	t.Helper()
	c, err := NewClient("test-key", "sandbox")
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	c.baseURL = serverURL
	return c
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(ApiErrorResponse{Message: http.StatusText(statusCode), Code: "ERR"})
}

func computeSig(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// ─── auth ─────────────────────────────────────────────────────────────────────

func TestNewClient_EmptyKey(t *testing.T) {
	if _, err := NewClient("", "sandbox"); err == nil {
		t.Fatal("expected error for empty API key")
	}
}

func TestNewClient_URLs(t *testing.T) {
	tests := []struct {
		env  string
		want string
	}{
		{"production", "https://api.subtrackr.app"},
		{"sandbox", "https://sandbox.api.subtrackr.app"},
	}
	for _, tc := range tests {
		t.Run(tc.env, func(t *testing.T) {
			c, err := NewClient("k", tc.env)
			if err != nil {
				t.Fatal(err)
			}
			if c.baseURL != tc.want {
				t.Errorf("got %s, want %s", c.baseURL, tc.want)
			}
		})
	}
}

// ─── contract endpoints ───────────────────────────────────────────────────────

func TestCreatePlan(t *testing.T) {
	tests := []struct {
		name   string
		req    CreatePlanRequest
		wantID int64
	}{
		{"monthly", CreatePlanRequest{Merchant: "GM", Name: "Pro", Price: 100, Token: "XLM", Interval: Monthly}, 1},
		{"yearly", CreatePlanRequest{Merchant: "GM", Name: "Ent", Price: 999, Token: "USDC", Interval: Yearly}, 2},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/create_plan" || r.Method != http.MethodPost {
					t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
				}
				writeJSON(w, tc.wantID)
			}))
			defer srv.Close()
			id, err := newTestClient(t, srv.URL).CreatePlan(tc.req)
			if err != nil {
				t.Fatal(err)
			}
			if id != tc.wantID {
				t.Errorf("got %d, want %d", id, tc.wantID)
			}
		})
	}
}

func TestSubscriptionLifecycle(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		action func(*Client) error
	}{
		{"pause", "/pause_subscription", func(c *Client) error { return c.PauseSubscription("G1", 42) }},
		{"resume", "/resume_subscription", func(c *Client) error { return c.ResumeSubscription("G1", 42) }},
		{"cancel", "/cancel_subscription", func(c *Client) error { return c.CancelSubscription("G1", 42) }},
		{"charge", "/charge_subscription", func(c *Client) error { return c.ChargeSubscription(42) }},
		{"approve_refund", "/approve_refund", func(c *Client) error { return c.ApproveRefund(42) }},
		{"reject_refund", "/reject_refund", func(c *Client) error { return c.RejectRefund(42) }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tc.path {
					t.Errorf("path: got %s, want %s", r.URL.Path, tc.path)
				}
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()
			if err := tc.action(newTestClient(t, srv.URL)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// ─── dunning ──────────────────────────────────────────────────────────────────

func TestDunning(t *testing.T) {
	entry := DunningEntry{ID: "dun_1", Status: DunningActive, AttemptCount: 1, MaxAttempts: 3}

	tests := []struct {
		name   string
		path   string
		method string
		action func(*Client) (DunningEntry, error)
	}{
		{
			"create", "/v1/dunning", http.MethodPost,
			func(c *Client) (DunningEntry, error) {
				return c.CreateDunningEntry(CreateDunningEntryRequest{SubscriptionID: 42, MaxAttempts: 3})
			},
		},
		{
			"get", "/v1/dunning/dun_1", http.MethodGet,
			func(c *Client) (DunningEntry, error) { return c.GetDunningEntry("dun_1") },
		},
		{
			"pause", "/v1/dunning/dun_1/pause", http.MethodPost,
			func(c *Client) (DunningEntry, error) { return c.PauseDunning("dun_1") },
		},
		{
			"resolve", "/v1/dunning/dun_1/resolve", http.MethodPost,
			func(c *Client) (DunningEntry, error) { return c.ResolveDunning("dun_1") },
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tc.path || r.Method != tc.method {
					t.Errorf("got %s %s, want %s %s", r.Method, r.URL.Path, tc.method, tc.path)
				}
				writeJSON(w, entry)
			}))
			defer srv.Close()
			got, err := tc.action(newTestClient(t, srv.URL))
			if err != nil {
				t.Fatal(err)
			}
			if got.ID != entry.ID {
				t.Errorf("id: got %s, want %s", got.ID, entry.ID)
			}
		})
	}
}

// ─── billing ──────────────────────────────────────────────────────────────────

func TestGetInvoice(t *testing.T) {
	want := Invoice{ID: "inv_1", Amount: 99.99, Currency: "USD", Status: "paid"}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, want)
	}))
	defer srv.Close()
	got, err := newTestClient(t, srv.URL).GetInvoice("inv_1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Amount != want.Amount {
		t.Errorf("amount: got %v, want %v", got.Amount, want.Amount)
	}
}

// ─── usage metering ───────────────────────────────────────────────────────────

func TestIngestUsage(t *testing.T) {
	want := UsageRecord{ID: "ur_1", MetricName: "api_calls", Quantity: 500}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/usage" || r.Method != http.MethodPost {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		writeJSON(w, want)
	}))
	defer srv.Close()
	got, err := newTestClient(t, srv.URL).IngestUsage(UsageIngestRequest{SubscriptionID: 42, MetricName: "api_calls", Quantity: 500})
	if err != nil {
		t.Fatal(err)
	}
	if got.MetricName != want.MetricName {
		t.Errorf("metric: got %s, want %s", got.MetricName, want.MetricName)
	}
}

func TestGetUsageSummary(t *testing.T) {
	want := UsageSummary{Metrics: map[string]float64{"api_calls": 1500}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, want)
	}))
	defer srv.Close()
	got, err := newTestClient(t, srv.URL).GetUsageSummary(42, 0, 9999999999)
	if err != nil {
		t.Fatal(err)
	}
	if got.Metrics["api_calls"] != 1500 {
		t.Errorf("metric: got %v, want 1500", got.Metrics["api_calls"])
	}
}

// ─── webhooks ─────────────────────────────────────────────────────────────────

func TestCreateWebhook(t *testing.T) {
	want := Webhook{ID: "wh_1", URL: "https://example.com/hook", Events: []string{"subscription.created"}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, want)
	}))
	defer srv.Close()
	got, err := newTestClient(t, srv.URL).CreateWebhook(want)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != want.ID {
		t.Errorf("id: got %s, want %s", got.ID, want.ID)
	}
}

func TestVerifyWebhookSignature(t *testing.T) {
	payload := []byte(`{"event":"subscription.created"}`)
	secret := "mysecret"
	validSig := computeSig(payload, secret)

	tests := []struct {
		name  string
		sig   string
		valid bool
	}{
		{"valid", validSig, true},
		{"wrong sig", "sha256=badhash", false},
		{"empty sig", "", false},
	}
	c, _ := NewClient("key", "sandbox")
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := c.VerifyWebhookSignature(WebhookVerifyRequest{Payload: payload, Signature: tc.sig, Secret: secret})
			if got != tc.valid {
				t.Errorf("got %v, want %v", got, tc.valid)
			}
		})
	}
}

// ─── retry ────────────────────────────────────────────────────────────────────

func TestRetry_SucceedsOnSecondAttempt(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 2 {
			writeError(w, http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, int64(1))
	}))
	defer srv.Close()
	if _, err := newTestClient(t, srv.URL).GetPlanCount(); err != nil {
		t.Fatalf("expected success after retry: %v", err)
	}
	if attempts < 2 {
		t.Errorf("expected >= 2 attempts, got %d", attempts)
	}
}

func TestRetry_PermanentError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusUnauthorized)
	}))
	defer srv.Close()
	if _, err := newTestClient(t, srv.URL).GetPlanCount(); err == nil {
		t.Fatal("expected error for 401")
	}
}

// ─── pagination ───────────────────────────────────────────────────────────────

func TestListSubscriptions_SendsCursorAndLimit(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		writeJSON(w, Page[Subscription]{Items: []Subscription{}, HasMore: false})
	}))
	defer srv.Close()
	if _, err := newTestClient(t, srv.URL).ListSubscriptions(PageOptions{Limit: 25, Cursor: "tok_abc"}); err != nil {
		t.Fatal(err)
	}
	if gotQuery == "" {
		t.Error("expected pagination query params")
	}
}

func TestListSubscriptions_EmptyPage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, Page[Subscription]{Items: []Subscription{}, HasMore: false})
	}))
	defer srv.Close()
	got, err := newTestClient(t, srv.URL).ListSubscriptions(PageOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if got.HasMore || len(got.Items) != 0 {
		t.Errorf("unexpected page: %+v", got)
	}
}
