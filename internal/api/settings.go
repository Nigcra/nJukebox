// settings.go
// Read endpoints for settings, including the honest answer for the history route
// Version: 2026.08.13

package api

import (
	"net/http"

	"github.com/Nigcra/nJukebox/internal/jsonx"
)

type settingsResponse struct {
	Success  bool          `json:"success"`
	Settings *jsonx.Object `json:"settings"`
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	settings, err := s.app.GetAllSettings(r.Context(), r.URL.Query().Get("category"))
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to get settings")
		return
	}
	writeJSON(w, http.StatusOK, settingsResponse{Success: true, Settings: settings})
}

type settingResponse struct {
	Success  bool   `json:"success"`
	Category string `json:"category"`
	Key      string `json:"key"`
	Value    any    `json:"value"`
}

// handleGetSetting reads from the in-memory cache, exactly like the synchronous
// getSetting() the Node handler called. A missing defaultValue query parameter
// arrives as undefined in JavaScript, which triggers the default parameter of
// getSetting and yields null - not a dropped field.
func (s *Server) handleGetSetting(w http.ResponseWriter, r *http.Request, params map[string]string) {
	var defaultValue any
	if raw, ok := r.URL.Query()["defaultValue"]; ok && len(raw) > 0 {
		defaultValue = raw[0]
	}

	value := s.app.GetSetting(params["category"], params["key"], defaultValue)

	writeJSON(w, http.StatusOK, settingResponse{
		Success:  true,
		Category: params["category"],
		Key:      params["key"],
		Value:    value,
	})
}

type settingHistoryResponse struct {
	Success   bool   `json:"success"`
	Category  string `json:"category"`
	Key       string `json:"key"`
	History   []any  `json:"history"`
	Supported bool   `json:"supported"`
}

// handleGetSettingHistory closes D2. The Node handler called a method that was
// never implemented and answered 500 for a feature that does not exist: there is
// no history table and no caller in the frontend. Answering 200 with an empty
// list and supported=false is honest and keeps the route alive.
func (s *Server) handleGetSettingHistory(w http.ResponseWriter, _ *http.Request, params map[string]string) {
	writeJSON(w, http.StatusOK, settingHistoryResponse{
		Success:   true,
		Category:  params["category"],
		Key:       params["key"],
		History:   []any{},
		Supported: false,
	})
}
