// config.go
// Loads the server configuration from config.json and applies the defaults
// Version: 2026.08.13

package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Default values, identical to the ones hardcoded in the Node servers.
const (
	DefaultHost     = "127.0.0.1"
	DefaultWebPort  = 5500
	DefaultDataPort = 3001
)

// Server mirrors the "server" object in config.json.
type Server struct {
	Host     string `json:"host"`
	WebPort  int    `json:"webPort"`
	DataPort int    `json:"dataPort"`
}

// Config mirrors config.json.
type Config struct {
	Server Server `json:"server"`
}

// Load reads config.json from root. A missing or unreadable file is not an
// error - the Node servers fall back to the defaults as well and only warn.
// The returned bool reports whether the file was actually used.
func Load(root string) (Config, bool, error) {
	cfg := Config{Server: Server{
		Host:     DefaultHost,
		WebPort:  DefaultWebPort,
		DataPort: DefaultDataPort,
	}}

	raw, err := os.ReadFile(filepath.Join(root, "config.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, false, nil
		}
		return cfg, false, err
	}

	// Unmarshal into a copy so a partial file keeps the defaults for the
	// fields it does not mention.
	parsed := cfg
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return cfg, false, err
	}

	if parsed.Server.Host != "" {
		cfg.Server.Host = parsed.Server.Host
	}
	if parsed.Server.WebPort != 0 {
		cfg.Server.WebPort = parsed.Server.WebPort
	}
	if parsed.Server.DataPort != 0 {
		cfg.Server.DataPort = parsed.Server.DataPort
	}

	return cfg, true, nil
}
