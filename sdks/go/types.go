package subtrackr

type Subscription struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Price    float64 `json:"price"`
	Currency string  `json:"currency"`
	Status   string  `json:"status"`
}

type Webhook struct {
	ID     string   `json:"id"`
	URL    string   `json:"url"`
	Events []string `json:"events"`
}

type ApiErrorResponse struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}
