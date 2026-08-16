# Makefile
# Build targets for nJukebox
# Version: 2026.08.16
#
# CGO is off everywhere. That is the whole reason for the Go port: no native
# modules, no toolchain on the target machine, one file to copy.

BINARY  := njukebox
VERSION := 2026.08.13
LDFLAGS := -s -w
RELEASE := _release

GO      ?= go
export CGO_ENABLED = 0

.PHONY: all build windows linux macos macos-arm dist test vet fmt check clean verify

all: build

## build: binary for the current platform
build:
	$(GO) build -ldflags "$(LDFLAGS)" -o $(BINARY)$(shell $(GO) env GOEXE) ./cmd/njukebox

# package: stages a complete, runnable package - binary, web/, licenses, README
# and the matching start/stop scripts - then zips it. The folder layout is what
# the server expects at runtime: the binary next to web/. Needs Info-ZIP (zip).
# $(1) = GOOS, $(2) = GOARCH, $(3) = binary name, $(4)/$(5) = start/stop script
define package
rm -rf $(RELEASE)/$(BINARY)-$(1)-$(2) $(RELEASE)/$(BINARY)-$(1)-$(2).zip
mkdir -p $(RELEASE)/$(BINARY)-$(1)-$(2)
GOOS=$(1) GOARCH=$(2) $(GO) build -ldflags "$(LDFLAGS)" -o $(RELEASE)/$(BINARY)-$(1)-$(2)/$(3) ./cmd/njukebox
cp -R web $(RELEASE)/$(BINARY)-$(1)-$(2)/web
cp LICENSE THIRD-PARTY-NOTICES.md README.md $(RELEASE)/$(BINARY)-$(1)-$(2)/
cp $(4) $(5) $(RELEASE)/$(BINARY)-$(1)-$(2)/
cd $(RELEASE) && zip -qr $(BINARY)-$(1)-$(2).zip $(BINARY)-$(1)-$(2)
endef

windows:
	$(call package,windows,amd64,$(BINARY).exe,start_jukebox.cmd,stop_jukebox.cmd)

linux:
	$(call package,linux,amd64,$(BINARY),start_jukebox.sh,stop_jukebox.sh)

macos:
	$(call package,darwin,amd64,$(BINARY),start_jukebox.sh,stop_jukebox.sh)

macos-arm:
	$(call package,darwin,arm64,$(BINARY),start_jukebox.sh,stop_jukebox.sh)

## dist: complete release packages (ZIP) for all platforms into _release/
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
	rm -rf dist $(RELEASE)
	rm -f $(BINARY) $(BINARY).exe
