package subtrackr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreatePlanPostsContractPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/create_plan" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}

		var payload CreatePlanRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Interval != Monthly {
			t.Fatalf("unexpected interval: %s", payload.Interval)
		}

		_, _ = w.Write([]byte("1"))
	}))
	defer server.Close()

	client, err := NewClient("test-key", "sandbox")
	if err != nil {
		t.Fatal(err)
	}
	client.baseURL = server.URL

	id, err := client.CreatePlan(CreatePlanRequest{
		Merchant: "GMERCHANT",
		Name:     "Pro",
		Price:    100,
		Token:    "TOKEN",
		Interval: Monthly,
	})
	if err != nil {
		t.Fatal(err)
	}
	if id != 1 {
		t.Fatalf("unexpected id: %d", id)
	}
}
