package subtrackr

import (
	"time"
)

type AuthManager struct {
	apiKey    string
	expiresAt time.Time
}

func NewAuthManager(apiKey string) (*AuthManager, error) {
	if apiKey == "" {
		return nil, &AuthenticationError{Message: "API Key is required to initialize the SDK"}
	}
	return &AuthManager{
		apiKey:    apiKey,
		expiresAt: time.Now().Add(30 * 24 * time.Hour),
	}, nil
}

func (a *AuthManager) GetToken() string {
	return a.apiKey
}
