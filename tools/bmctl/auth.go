package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Config comes from the environment so no password ever sits in a shell history or a flag.
type Config struct {
	API, Region, ClientID, User, Pass, Code string
	IDP                                     string // override for tests
}

type authResp struct {
	AuthenticationResult *struct {
		IdToken string `json:"IdToken"`
	} `json:"AuthenticationResult"`
	ChallengeName string `json:"ChallengeName"`
	Session       string `json:"Session"`
	Message       string `json:"message"`
	Type          string `json:"__type"`
}

var client = &http.Client{Timeout: 20 * time.Second}

func (c Config) idp() string {
	if c.IDP != "" {
		return c.IDP
	}
	return fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/", c.Region)
}

func (c Config) call(target string, body any) (*authResp, error) {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", c.idp(), bytes.NewReader(b))
	req.Header.Set("content-type", "application/x-amz-json-1.1")
	req.Header.Set("x-amz-target", "AWSCognitoIdentityProviderService."+target)
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var out authResp
	_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out)
	if res.StatusCode != 200 {
		msg := out.Message
		if msg == "" {
			msg = out.Type
		}
		return nil, fmt.Errorf("sign-in failed: %s", msg)
	}
	return &out, nil
}

// Token signs in and returns an ID token. First logins (new password) are not handled here: do those in the dashboard.
func (c Config) Token() (string, error) {
	if c.ClientID == "" || c.User == "" || c.Pass == "" {
		return "", errors.New("set BM_CLIENT, BM_USER and BM_PASS")
	}
	r, err := c.call("InitiateAuth", map[string]any{
		"AuthFlow": "USER_PASSWORD_AUTH", "ClientId": c.ClientID,
		"AuthParameters": map[string]string{"USERNAME": c.User, "PASSWORD": c.Pass},
	})
	if err != nil {
		return "", err
	}
	if r.AuthenticationResult != nil {
		return r.AuthenticationResult.IdToken, nil
	}
	switch r.ChallengeName {
	case "SOFTWARE_TOKEN_MFA":
		if c.Code == "" {
			return "", errors.New("this account uses two-step sign-in: set BM_CODE to the current 6-digit code")
		}
		r, err = c.call("RespondToAuthChallenge", map[string]any{
			"ChallengeName": "SOFTWARE_TOKEN_MFA", "ClientId": c.ClientID, "Session": r.Session,
			"ChallengeResponses": map[string]string{"USERNAME": c.User, "SOFTWARE_TOKEN_MFA_CODE": c.Code},
		})
		if err != nil {
			return "", err
		}
		if r.AuthenticationResult != nil {
			return r.AuthenticationResult.IdToken, nil
		}
	case "NEW_PASSWORD_REQUIRED":
		return "", errors.New("first sign-in needs a new password: do that once in the dashboard")
	}
	return "", fmt.Errorf("unsupported sign-in step %q", r.ChallengeName)
}
