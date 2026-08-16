// auth.go
// PKCE code exchange against the Spotify accounts API
// Version: 2026.08.13

package spotify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultTokenURL is the Spotify token endpoint. Tests point the client at a
// local httptest server instead.
const DefaultTokenURL = "https://accounts.spotify.com/api/token"

// defaultExpiresIn is what Spotify hands out today. It only ever applies when a
// response omits expires_in.
const defaultExpiresIn = 3600

// Client talks to accounts.spotify.com. PKCE needs no client secret, so the
// client id is the only credential involved - and it is never logged.
type Client struct {
	httpClient *http.Client
	tokenURL   string
	apiBase    string
}

// NewClient returns a client for the real Spotify endpoint.
func NewClient() *Client {
	return &Client{
		httpClient: &http.Client{Timeout: 20 * time.Second},
		tokenURL:   DefaultTokenURL,
	}
}

// TokenResponse is the payload of a successful token request.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

// Error is an error answer of the accounts API. Only the status and the two
// error fields are kept; the request body holding the tokens is never part of
// the message.
type Error struct {
	Status      int
	Code        string
	Description string
}

func (e *Error) Error() string {
	if e.Description != "" {
		return fmt.Sprintf("spotify token endpoint: %s (%s, HTTP %d)", e.Code, e.Description, e.Status)
	}
	if e.Code != "" {
		return fmt.Sprintf("spotify token endpoint: %s (HTTP %d)", e.Code, e.Status)
	}
	return fmt.Sprintf("spotify token endpoint: HTTP %d", e.Status)
}

// IsInvalidGrant reports whether Spotify rejected the grant itself. That is the
// only condition that justifies dropping the stored login: the refresh token is
// gone for good, everything else is worth another attempt.
func IsInvalidGrant(err error) bool {
	var apiErr *Error
	if !errors.As(err, &apiErr) {
		return false
	}
	return apiErr.Code == "invalid_grant"
}

// ExchangeCode trades an authorization code plus its PKCE verifier for tokens.
func (c *Client) ExchangeCode(ctx context.Context, clientID, code, verifier, redirectURI string) (*TokenResponse, error) {
	return c.post(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"client_id":     {clientID},
		"code_verifier": {verifier},
	})
}

// Refresh trades a refresh token for a new access token. Spotify usually
// answers with a new refresh token as well and invalidates the one sent.
func (c *Client) Refresh(ctx context.Context, clientID, refreshToken string) (*TokenResponse, error) {
	return c.post(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {clientID},
	})
}

func (c *Client) post(ctx context.Context, form url.Values) (*TokenResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("build token request: %w", err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call token endpoint: %w", err)
	}
	defer response.Body.Close()

	// The bodies of this endpoint are small; the limit only guards against a
	// broken proxy answering with something huge.
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read token response: %w", err)
	}

	if response.StatusCode < 200 || response.StatusCode > 299 {
		var failure struct {
			Error            string `json:"error"`
			ErrorDescription string `json:"error_description"`
		}
		// A non JSON body leaves the fields empty, which is still enough to
		// report the status.
		_ = json.Unmarshal(body, &failure)
		return nil, &Error{
			Status:      response.StatusCode,
			Code:        failure.Error,
			Description: failure.ErrorDescription,
		}
	}

	var parsed TokenResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}
	if parsed.AccessToken == "" {
		return nil, errors.New("token response contained no access token")
	}
	if parsed.ExpiresIn <= 0 {
		parsed.ExpiresIn = defaultExpiresIn
	}
	return &parsed, nil
}
