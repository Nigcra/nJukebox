// writes_settings.go
// Write endpoints for the settings store, including the D1 fix for DELETE
// Version: 2026.08.13

package api

import (
	"encoding/json"
	"net/http"
)

// defaultSettingType is the "type = 'string'" default of the destructuring in
// the Node handler. The value is only echoed back - setSetting derives the type
// it stores from the value itself and never looked at this parameter (R4).
var defaultSettingType = json.RawMessage(`"string"`)

type setSettingResponse struct {
	Success  bool            `json:"success"`
	Category string          `json:"category"`
	Key      string          `json:"key"`
	Value    json.RawMessage `json:"value"`
	Type     json.RawMessage `json:"type"`
}

// handleSetSetting writes one setting.
//
// A body without a value is not an error case here: undefined reached sqlite3
// as NULL, the NOT NULL column rejected it and the handler answered 500. The
// baseline froze that in err-settings-no-value.txt, so the request has to keep
// failing exactly there.
func (s *Server) handleSetSetting(w http.ResponseWriter, r *http.Request, params map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	category := params["category"]
	key := params["key"]

	value, present := body.decoded("value")

	if err := s.app.SetSetting(r.Context(), category, key, value, present); err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to set setting")
		return
	}

	// The global debug flag follows this one setting.
	if category == "admin" && key == "debuggingEnabled" {
		s.setDebugging(body.truthy("value"))
	}

	settingType := body.raw("type")
	if settingType == nil {
		settingType = defaultSettingType
	}

	writeJSON(w, http.StatusOK, setSettingResponse{
		Success:  true,
		Category: category,
		Key:      key,
		Value:    nullRaw(body.raw("value")),
		Type:     settingType,
	})
}

type batchSettingResult struct {
	Category string          `json:"category"`
	Key      string          `json:"key"`
	Value    json.RawMessage `json:"value"`
	Type     json.RawMessage `json:"type"`
}

type batchSettingsResponse struct {
	Success bool                 `json:"success"`
	Updated int                  `json:"updated"`
	Results []batchSettingResult `json:"results"`
}

// handleSettingsBatch writes a list of settings. The Node handler looped over
// the array and called setSetting once per entry, so the entries before a
// failure stayed written - this port keeps that, no transaction is used.
func (s *Server) handleSettingsBatch(w http.ResponseWriter, r *http.Request, _ map[string]string) {
	body, ok := decodeBody(r)
	if !ok {
		internalError(w)
		return
	}

	raw, present := body["settings"]
	if !present || !isJSONArray(raw) {
		// "for (const setting of undefined)" threw a TypeError, which the catch
		// turned into this answer.
		failPlain(w, http.StatusInternalServerError, "Failed to batch update settings")
		return
	}

	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to batch update settings")
		return
	}

	results := []batchSettingResult{}

	for _, entry := range entries {
		var setting jsonBody
		if err := json.Unmarshal(entry, &setting); err != nil {
			failPlain(w, http.StatusInternalServerError, "Failed to batch update settings")
			return
		}

		category, categoryOK := setting.text("category")
		key, keyOK := setting.text("key")
		if !categoryOK || !keyOK {
			// Both columns are NOT NULL, so an entry without them failed.
			failPlain(w, http.StatusInternalServerError, "Failed to batch update settings")
			return
		}

		value, valuePresent := setting.decoded("value")

		if err := s.app.SetSetting(r.Context(), category, key, value, valuePresent); err != nil {
			failPlain(w, http.StatusInternalServerError, "Failed to batch update settings")
			return
		}

		if category == "admin" && key == "debuggingEnabled" {
			s.setDebugging(setting.truthy("value"))
		}

		settingType := setting.raw("type")
		if settingType == nil {
			settingType = defaultSettingType
		}

		results = append(results, batchSettingResult{
			Category: category,
			Key:      key,
			Value:    nullRaw(setting.raw("value")),
			Type:     settingType,
		})
	}

	writeJSON(w, http.StatusOK, batchSettingsResponse{
		Success: true,
		Updated: len(results),
		Results: results,
	})
}

type deleteSettingResponse struct {
	Success  bool   `json:"success"`
	Category string `json:"category"`
	Key      string `json:"key"`
	Deleted  bool   `json:"deleted"`
}

// handleDeleteSetting closes D1.
//
// In Node the delete itself ran, but the callback then touched
// this.settingsCache with "this" bound to the sqlite3 statement. The resulting
// TypeError fired inside a native callback, outside every promise chain, and
// took the whole process down - a single request killed the data server. Here
// the cache is a map behind a mutex and the handler simply answers.
func (s *Server) handleDeleteSetting(w http.ResponseWriter, r *http.Request, params map[string]string) {
	category := params["category"]
	key := params["key"]

	deleted, err := s.app.DeleteSetting(r.Context(), category, key)
	if err != nil {
		failPlain(w, http.StatusInternalServerError, "Failed to delete setting")
		return
	}

	writeJSON(w, http.StatusOK, deleteSettingResponse{
		Success:  true,
		Category: category,
		Key:      key,
		Deleted:  deleted > 0,
	})
}
