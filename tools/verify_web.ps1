# verify_web.ps1
# Verifies the web server: URL rewrites, allowlist (S2) and traversal defence (S1)
# Version: 2026.08.13
#
# Requests are sent over a raw socket on purpose. HTTP clients normalize ".."
# in the path before sending, which would silently turn the traversal probes
# into harmless requests and prove nothing.
#
#   pwsh tools/verify_web.ps1
#
# Exit code 0 means every case behaved as expected.

param(
	[string]$ServerHost = '127.0.0.1',
	[int]$Port = 5500,

	# Use an already running server instead of starting one.
	[switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Send-Raw {
	param([string]$Method, [string]$Target)

	$client = New-Object System.Net.Sockets.TcpClient
	$client.Connect($ServerHost, $Port)
	try {
		$stream = $client.GetStream()
		$text = "$Method $Target HTTP/1.1`r`nHost: ${ServerHost}:${Port}`r`nConnection: close`r`n`r`n"
		$bytes = [System.Text.Encoding]::ASCII.GetBytes($text)
		$stream.Write($bytes, 0, $bytes.Length)
		$stream.Flush()

		$memory = New-Object System.IO.MemoryStream
		$stream.CopyTo($memory)
		$raw = $memory.ToArray()
	}
	finally {
		$client.Close()
	}

	# Split headers from body at the first CRLFCRLF.
	$headerText = [System.Text.Encoding]::ASCII.GetString($raw)
	$split = $headerText.IndexOf("`r`n`r`n")
	$headers = if ($split -ge 0) { $headerText.Substring(0, $split) } else { $headerText }
	$bodyLength = if ($split -ge 0) { $raw.Length - ($split + 4) } else { 0 }

	$status = 0
	if ($headers -match '^HTTP/1\.\d (\d{3})') { $status = [int]$Matches[1] }

	$contentType = ''
	if ($headers -match '(?im)^Content-Type:\s*(.+)$') { $contentType = $Matches[1].Trim() }

	[pscustomobject]@{
		Status      = $status
		ContentType = $contentType
		Length      = $bodyLength
	}
}

# Case list: description, target, expected status, expected content type ('' = do not check)
$cases = @(
	@{ Name = 'root rewrite'; Target = '/'; Status = 200; Type = 'text/html' }
	@{ Name = 'index_web rewrite'; Target = '/index_web'; Status = 200; Type = 'text/html' }
	@{ Name = 'stylesheet'; Target = '/style.css'; Status = 200; Type = 'text/css' }
	@{ Name = 'main script'; Target = '/jukebox.js'; Status = 200; Type = 'application/javascript' }
	@{ Name = 'module script'; Target = '/js/visualizer.js'; Status = 200; Type = 'application/javascript' }
	@{ Name = 'asset image'; Target = '/assets/default_cover.png'; Status = 200; Type = 'image/png' }
	@{ Name = 'font stays octet-stream'; Target = '/assets/roboto.woff2'; Status = 200; Type = 'application/octet-stream' }
	@{ Name = 'locale'; Target = '/locales/de.json'; Status = 200; Type = 'application/json' }
	@{ Name = 'query string ignored'; Target = '/style.css?v=123'; Status = 200; Type = 'text/css' }
	@{ Name = 'unknown path'; Target = '/does_not_exist.js'; Status = 404; Type = '' }

	# S1 - directory traversal, raw and percent encoded
	@{ Name = 'S1 traversal raw'; Target = '/../../../../Windows/win.ini'; Status = 404; Type = '' }
	@{ Name = 'S1 traversal encoded'; Target = '/..%2F..%2F..%2F..%2FWindows%2Fwin.ini'; Status = 404; Type = '' }
	@{ Name = 'S1 traversal below allowed dir'; Target = '/js/../../../Windows/win.ini'; Status = 404; Type = '' }
	@{ Name = 'S1 backslash separator'; Target = '/js\..\..\Windows\win.ini'; Status = 404; Type = '' }

	# S2 - everything outside the allowlist. Since the web root is web/ rather
	# than the project directory, most of these are not below it at all any more.
	@{ Name = 'S2 server configuration'; Target = '/config.json'; Status = 404; Type = '' }
	@{ Name = 'S2 web directory not doubled'; Target = '/web/style.css'; Status = 404; Type = '' }
	@{ Name = 'S2 application database'; Target = '/data/app.db'; Status = 404; Type = '' }
	@{ Name = 'S2 music database'; Target = '/data/music.db'; Status = 404; Type = '' }
	@{ Name = 'S2 go module'; Target = '/go.mod'; Status = 404; Type = '' }
	@{ Name = 'S2 tooling'; Target = '/tools/verify_web.ps1'; Status = 404; Type = '' }
	@{ Name = 'S2 project notes'; Target = '/CLAUDE.md'; Status = 404; Type = '' }
	@{ Name = 'S2 git directory'; Target = '/.git/config'; Status = 404; Type = '' }
	@{ Name = 'S2 source directory'; Target = '/internal/web/server.go'; Status = 404; Type = '' }
)

$server = $null
try {
	if (-not $NoStart) {
		Push-Location $root
		$exe = Join-Path $env:TEMP 'njukebox.exe'
		$env:CGO_ENABLED = '0'
		& go build -o $exe ./cmd/njukebox
		if ($LASTEXITCODE -ne 0) { throw 'Build of njukebox failed' }
		Pop-Location

		$server = Start-Process -PassThru -NoNewWindow -FilePath $exe `
			-ArgumentList '--web-only' -WorkingDirectory $root

		$ready = $false
		foreach ($i in 1..40) {
			Start-Sleep -Milliseconds 250
			try {
				$probe = Send-Raw -Method 'GET' -Target '/'
				if ($probe.Status -eq 200) { $ready = $true; break }
			}
			catch { }
		}
		if (-not $ready) { throw "Server was not reachable on ${ServerHost}:${Port}" }
	}

	$failed = 0
	foreach ($case in $cases) {
		$result = Send-Raw -Method 'GET' -Target $case.Target

		$problems = @()
		if ($result.Status -ne $case.Status) {
			$problems += "status $($result.Status), expected $($case.Status)"
		}
		if ($case.Type -and $result.ContentType -ne $case.Type) {
			$problems += "content-type '$($result.ContentType)', expected '$($case.Type)'"
		}

		if ($problems.Count -gt 0) {
			$failed++
			Write-Host ("FAIL  {0,-32} {1}" -f $case.Name, ($problems -join '; '))
		}
		else {
			Write-Host ("ok    {0,-32} {1} {2} bytes" -f $case.Name, $result.Status, $result.Length)
		}
	}

	Write-Host ''
	if ($failed -gt 0) {
		Write-Host "$failed of $($cases.Count) cases failed."
		exit 1
	}
	Write-Host "All $($cases.Count) cases passed."
	exit 0
}
finally {
	if ($server -and -not $server.HasExited) {
		Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
	}
}
