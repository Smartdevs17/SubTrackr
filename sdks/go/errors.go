package subtrackr

import "fmt"

type ApiError struct {
	Message    string
	StatusCode int
	Code       string
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
