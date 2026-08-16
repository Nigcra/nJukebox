# Makefile
# Build targets for nJukebox
# Version: 2026.08.16
#
# CGO is off everywhere. That is the whole reason for the Go port: no native
# modules, no toolchain on the target machine, one file to copy.

BINARY  := njukebox
VERSION := 2026.08.13
LDFLAGS := -s -w

GO      ?= go
export CGO_ENABLED = 0

.PHONY: all build windows linux macos macos-arm dist test vet fmt check clean verify

all: build

## build: binary for the current platform
build:
	$(GO) build -ldflags "$(LDFLAGS)" -o $(BINARY)$(shell $(GO) env GOEXE) ./cmd/njukebox

windows:
	GOOS=windows GOARCH=amd64 $(GO) build -ldflags "$(LDFLAGS)" -o dist/$(BINARY)-windows-amd64.exe ./cmd/njukebox

linux:
	GOOS=linux GOARCH=amd64 $(GO) build -ldflags "$(LDFLAGS)" -o dist/$(BINARY)-linux-amd64 ./cmd/njukebox

macos:
	GOOS=darwin GOARCH=amd64 $(GO) build -ldflags "$(LDFLAGS)" -o dist/$(BINARY)-darwin-amd64 ./cmd/njukebox

macos-arm:
	GOOS=darwin GOARCH=arm64 $(GO) build -ldflags "$(LDFLAGS)" -o dist/$(BINARY)-darwin-arm64 ./cmd/njukebox

## dist: all platforms at once
dist: windows linux macos macos-arm

test:
	$(GO) test ./... -count=1

vet:
	$(GO) vet ./...

fmt:
	$(GO) fmt ./...

## check: what has to pass before a commit
check: fmt vet test

## verify: the web server checks against a real binary, needs PowerShell 7
verify:
	pwsh tools/verify_web.ps1

clean:
	rm -rf dist
	rm -f $(BINARY) $(BINARY).exe
