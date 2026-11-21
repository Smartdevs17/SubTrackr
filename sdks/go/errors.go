package subtrackr

import (
	"encoding/json"
	"fmt"
)

type ApiError struct {
	Message    string
	StatusCode int
	Code       string
	// RequestID is the server-assigned request id (envelope meta.requestId).
	RequestID string
	// Details holds per-field validation messages (envelope error.details).
	Details map[string]string
}

// Retryable reports whether retrying the same request may succeed.
func (e *ApiError) Retryable() bool {
	return e.StatusCode == 408 || e.StatusCode == 429 || e.StatusCode >= 500
}

func (e *ApiError) Error() string {
	return fmt.Sprintf("API Error %d: %s", e.StatusCode, e.Message)
}

type AuthenticationError struct {
	Message string
}

func (e *AuthenticationError) Error() string {
	return fmt.Sprintf("Authentication Error: %s", e.Message)
}

// parsedError is the normalised content of an error response body.
type parsedError struct {
	Message   string
	Code      string
	RequestID string
	Details   map[string]string
}

// parseErrorBody extracts error information from a response body. It accepts
// the canonical envelope {"success":false,"error":{code,message,details},
// "meta":{requestId}} and the legacy shapes {"message","code"} and
// {"error":"text"}. fallback is used when no message can be found.
func parseErrorBody(body []byte, fallback string) parsedError {
	var raw struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
		Code    string          `json:"code"`
		Meta    struct {
			RequestID string `json:"requestId"`
		} `json:"meta"`
	}
	out := parsedError{Message: fallback}
	if err := json.Unmarshal(body, &raw); err != nil {
		return out
	}
	out.RequestID = raw.Meta.RequestID

	var obj struct {
		Code    string            `json:"code"`
		Message string            `json:"message"`
		Details map[string]string `json:"details"`
	}
	var text string
	switch {
	case len(raw.Error) > 0 && json.Unmarshal(raw.Error, &obj) == nil:
		out.Code = obj.Code
		out.Details = obj.Details
		if obj.Message != "" {
			out.Message = obj.Message
		}
	case len(raw.Error) > 0 && json.Unmarshal(raw.Error, &text) == nil && text != "":
		out.Message = text
		out.Code = raw.Code
	default:
		out.Code = raw.Code
		if raw.Message != "" {
			out.Message = raw.Message
		}
	}
	return out
}
