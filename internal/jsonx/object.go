// object.go
// JSON object that keeps insertion order, like a JavaScript object literal
// Version: 2026.08.13

package jsonx

import (
	"bytes"
	"encoding/json"
)

// Object marshals its entries in insertion order.
//
// Go maps are serialized with their keys sorted, JavaScript objects keep the
// order in which the keys were added. That difference is invisible in the
// normalized golden body but not in the ETag, which Express derives from the
// exact bytes of the response. Anywhere the Node code built an object from
// database rows, the row order is part of the contract.
type Object struct {
	keys   []string
	values map[string]any
}

// NewObject returns an empty object.
func NewObject() *Object {
	return &Object{values: map[string]any{}}
}

// Set adds or replaces a value. Replacing keeps the original position, which is
// what assigning to an existing JavaScript property does.
func (o *Object) Set(key string, value any) {
	if _, exists := o.values[key]; !exists {
		o.keys = append(o.keys, key)
	}
	o.values[key] = value
}

// Get returns a value and whether it exists.
func (o *Object) Get(key string) (any, bool) {
	value, ok := o.values[key]
	return value, ok
}

// Len reports the number of entries.
func (o *Object) Len() int {
	return len(o.keys)
}

// Keys returns the keys in insertion order.
func (o *Object) Keys() []string {
	return o.keys
}

// MarshalJSON writes the entries in insertion order. HTML escaping is off
// because JSON.stringify does not escape "<", ">" or "&" either.
func (o *Object) MarshalJSON() ([]byte, error) {
	if o == nil {
		return []byte("null"), nil
	}

	var buf bytes.Buffer
	buf.WriteByte('{')

	for i, key := range o.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		if err := encodeInto(&buf, key); err != nil {
			return nil, err
		}
		buf.WriteByte(':')
		if err := encodeInto(&buf, o.values[key]); err != nil {
			return nil, err
		}
	}

	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func encodeInto(buf *bytes.Buffer, value any) error {
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return err
	}
	buf.Write(bytes.TrimSuffix(encoded.Bytes(), []byte("\n")))
	return nil
}
