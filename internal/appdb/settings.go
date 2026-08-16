// settings.go
// Settings storage with type coercion and a mutex guarded cache
// Version: 2026.08.13

package appdb

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strconv"

	"github.com/Nigcra/nJukebox/internal/jsonx"
)

// Setting is one row of the settings table.
type Setting struct {
	Category string
	Key      string
	Value    string
	Type     string
}

// RestoreCache reloads every setting into the in-memory cache.
func (a *DB) RestoreCache() error {
	rows, err := a.read.Query("SELECT category, key, value, type FROM settings")
	if err != nil {
		return fmt.Errorf("restore settings cache: %w", err)
	}
	defer rows.Close()

	cache := make(map[string]any)
	for rows.Next() {
		var s Setting
		if err := rows.Scan(&s.Category, &s.Key, &s.Value, &s.Type); err != nil {
			return fmt.Errorf("scan setting: %w", err)
		}
		cache[s.Category+"."+s.Key] = parseSettingValue(s.Value, s.Type)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	a.settingsMu.Lock()
	a.settingsCache = cache
	a.settingsMu.Unlock()

	log.Print("[APP-DB] Settings cache restored")
	return nil
}

// ClearCache empties the settings cache.
func (a *DB) ClearCache() {
	a.settingsMu.Lock()
	a.settingsCache = make(map[string]any)
	a.settingsMu.Unlock()
	log.Print("Settings cache cleared")
}

// GetSetting reads from the cache only, like the synchronous getSetting().
func (a *DB) GetSetting(category, key string, defaultValue any) any {
	a.settingsMu.RLock()
	defer a.settingsMu.RUnlock()

	if value, ok := a.settingsCache[category+"."+key]; ok {
		return value
	}
	return defaultValue
}

// GetSettingFromDB reads one setting from the database and refreshes the cache.
// Returns defaultValue when the setting does not exist.
func (a *DB) GetSettingFromDB(ctx context.Context, category, key string, defaultValue any) (any, error) {
	var s Setting
	err := a.read.QueryRowContext(ctx,
		"SELECT value, type FROM settings WHERE category = ? AND key = ?",
		category, key).Scan(&s.Value, &s.Type)
	if err != nil {
		// No row is not an error - the default applies.
		if err.Error() == "sql: no rows in result set" {
			return defaultValue, nil
		}
		return nil, fmt.Errorf("get setting: %w", err)
	}

	parsed := parseSettingValue(s.Value, s.Type)

	a.settingsMu.Lock()
	a.settingsCache[category+"."+key] = parsed
	a.settingsMu.Unlock()

	return parsed, nil
}

// GetAllSettings returns the settings grouped by category, optionally
// restricted to one category.
//
// The result keeps the row order of the query, because that is the order the
// JavaScript object was built in and therefore part of the ETag.
func (a *DB) GetAllSettings(ctx context.Context, category string) (*jsonx.Object, error) {
	query := "SELECT category, key, value, type FROM settings"
	var params []any
	if category != "" {
		query += " WHERE category = ?"
		params = append(params, category)
	}

	rows, err := a.read.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, fmt.Errorf("query settings: %w", err)
	}
	defer rows.Close()

	settings := jsonx.NewObject()
	for rows.Next() {
		var s Setting
		if err := rows.Scan(&s.Category, &s.Key, &s.Value, &s.Type); err != nil {
			return nil, fmt.Errorf("scan setting: %w", err)
		}

		entry, ok := settings.Get(s.Category)
		if !ok {
			entry = jsonx.NewObject()
			settings.Set(s.Category, entry)
		}
		entry.(*jsonx.Object).Set(s.Key, parseSettingValue(s.Value, s.Type))
	}
	return settings, rows.Err()
}

// SetSetting writes one setting. present reports whether the request actually
// carried a value: a missing value must reach the database as NULL so the NOT
// NULL constraint fires, exactly like passing undefined did in Node. An
// explicit JSON null on the other hand is stored as the string "null" with type
// "object", because typeof null is "object" in JavaScript.
func (a *DB) SetSetting(ctx context.Context, category, key string, value any, present bool) error {
	stringValue, typeName := coerceSettingValue(value, present)

	const query = `INSERT OR REPLACE INTO settings (category, key, value, type, updated_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`

	if _, err := a.db.ExecContext(ctx, query, category, key, stringValue, typeName); err != nil {
		return fmt.Errorf("save setting: %w", err)
	}

	a.settingsMu.Lock()
	a.settingsCache[category+"."+key] = value
	a.settingsMu.Unlock()

	return nil
}

// UpdateMultipleSettings writes a batch of settings in one transaction.
func (a *DB) UpdateMultipleSettings(ctx context.Context, data map[string]map[string]any) (int, error) {
	type update struct {
		category string
		key      string
		value    any
	}

	var updates []update
	for category, entries := range data {
		for key, value := range entries {
			updates = append(updates, update{category, key, value})
		}
	}

	if len(updates) == 0 {
		return 0, nil
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin settings batch: %w", err)
	}
	defer tx.Rollback()

	const query = `INSERT OR REPLACE INTO settings (category, key, value, type, updated_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`

	for _, u := range updates {
		stringValue, typeName := coerceSettingValue(u.value, true)
		if _, err := tx.ExecContext(ctx, query, u.category, u.key, stringValue, typeName); err != nil {
			return 0, fmt.Errorf("update setting in batch: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit settings batch: %w", err)
	}

	a.settingsMu.Lock()
	for _, u := range updates {
		a.settingsCache[u.category+"."+u.key] = u.value
	}
	a.settingsMu.Unlock()

	log.Printf("Batch updated %d settings", len(updates))
	return len(updates), nil
}

// DeleteSetting removes one setting and drops it from the cache. This is the
// endpoint that killed the Node process (D1); here the cache is just a map
// behind a mutex.
func (a *DB) DeleteSetting(ctx context.Context, category, key string) (int64, error) {
	result, err := a.db.ExecContext(ctx,
		"DELETE FROM settings WHERE category = ? AND key = ?", category, key)
	if err != nil {
		return 0, fmt.Errorf("delete setting: %w", err)
	}

	a.settingsMu.Lock()
	delete(a.settingsCache, category+"."+key)
	a.settingsMu.Unlock()

	return result.RowsAffected()
}

// parseSettingValue turns the stored text back into a typed value. A value that
// fails to parse is returned as the raw string, matching the Node behaviour of
// warning and keeping the original (R4).
func parseSettingValue(value, typeName string) any {
	switch typeName {
	case "number":
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil {
			log.Printf("Failed to parse setting value: %v", err)
			return value
		}
		return parsed
	case "boolean":
		return value == "true"
	case "object", "array":
		var parsed any
		if err := json.Unmarshal([]byte(value), &parsed); err != nil {
			log.Printf("Failed to parse setting value: %v", err)
			return value
		}
		return parsed
	default:
		return value
	}
}

// coerceSettingValue mirrors the typeof cascade of setSetting().
func coerceSettingValue(value any, present bool) (any, string) {
	if !present {
		// undefined in JavaScript: bound as NULL, which the NOT NULL column
		// rejects. The 500 that follows is the documented behaviour.
		return nil, "string"
	}

	switch v := value.(type) {
	case float64:
		return formatJSNumber(v), "number"
	case bool:
		if v {
			return "true", "boolean"
		}
		return "false", "boolean"
	case string:
		return v, "string"
	case nil:
		// typeof null === 'object', JSON.stringify(null) === 'null'
		return "null", "object"
	case []any:
		encoded, err := json.Marshal(v)
		if err != nil {
			return "null", "array"
		}
		return string(encoded), "array"
	default:
		encoded, err := json.Marshal(v)
		if err != nil {
			return "null", "object"
		}
		return string(encoded), "object"
	}
}

// formatJSNumber renders a float the way Number.prototype.toString does:
// plain notation between 1e-6 and 1e21, exponential outside that range.
func formatJSNumber(v float64) string {
	if v == 0 {
		return "0"
	}
	abs := math.Abs(v)
	if abs >= 1e-6 && abs < 1e21 {
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return strconv.FormatFloat(v, 'g', -1, 64)
}
