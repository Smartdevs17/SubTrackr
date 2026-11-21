package subtrackr

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseErrorBody_Canonical(t *testing.T) {
	p := parseErrorBody([]byte(`{"success":false,"error":{"code":"VALIDATION","message":"bad","details":{"amount":"positive"}},"meta":{"requestId":"r1"}}`), "fb")
	if p.Message != "bad" || p.Code != "VALIDATION" || p.RequestID != "r1" || p.Details["amount"] != "positive" {
		t.Fatalf("unexpected: %+v", p)
	}
}

func TestParseErrorBody_Legacy(t *testing.T) {
	p := parseErrorBody([]byte(`{"message":"m","code":"c"}`), "fb")
	if p.Message != "m" || p.Code != "c" {
		t.Fatalf("unexpected: %+v", p)
	}
	p = parseErrorBody([]byte(`{"error":"oops"}`), "fb")
	if p.Message != "oops" {
		t.Fatalf("unexpected: %+v", p)
	}
}

func TestParseErrorBody_Fallbacks(t *testing.T) {
	for _, body := range []string{``, `<html>`, `{}`, `{"error":{"message":""}}`} {
		if got := parseErrorBody([]byte(body), "fb").Message; got != "fb" {
			t.Errorf("body %q: got %q, want fb", body, got)
		}
	}
}

func TestApiError_Retryable(t *testing.T) {
	for code, want := range map[int]bool{400: false, 404: false, 408: true, 429: true, 500: true, 503: true} {
		if got := (&ApiError{StatusCode: code}).Retryable(); got != want {
			t.Errorf("status %d: got %v, want %v", code, got, want)
		}
	}
}

func TestClient_SurfacesEnvelopeFields(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"NOT_FOUND","message":"gone"},"meta":{"requestId":"rid"}}`))
	}))
	defer srv.Close()

	c := newTestClient(t, srv.URL)
	var out map[string]interface{}
	err := c.doRequest("GET", "/x", nil, &out)
	apiErr, ok := err.(*ApiError)
	if !ok {
		t.Fatalf("expected *ApiError, got %T (%v)", err, err)
	}
	if apiErr.Code != "NOT_FOUND" || apiErr.Message != "gone" || apiErr.RequestID != "rid" || apiErr.StatusCode != 404 {
		t.Fatalf("unexpected: %+v", apiErr)
	}
}
