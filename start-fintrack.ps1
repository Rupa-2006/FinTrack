# Starts FinTrack on this computer: API, AI service and website, each in its own window,
# then opens the website. Close those windows (or press Ctrl+C in them) to stop.
# Easiest: double-click start-fintrack.cmd.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Write-Step($text) { Write-Host "`n> $text" -ForegroundColor Cyan }
function Stop-WithError($text) {
    Write-Host "`n$text" -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}
function Test-Url($url) {
    # A direct request with no proxy lookup: Invoke-WebRequest can spend many seconds on proxy
    # detection in Windows PowerShell 5.1.
    try {
        $request = [System.Net.WebRequest]::Create($url)
        $request.Proxy = $null
        $request.Timeout = 2000
        $response = $request.GetResponse()
        $ok = [int]$response.StatusCode -eq 200
        $response.Close()
        $ok
    } catch { $false }
}

Write-Host 'FinTrack local start' -ForegroundColor Green

# 1. MySQL
Write-Step 'Checking MySQL'
$mysql = Get-Service -Name 'MySQL*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $mysql) { Stop-WithError 'MySQL is not installed as a Windows service. See docs/INSTALLATION.md.' }
if ($mysql.Status -ne 'Running') {
    Stop-WithError "MySQL ($($mysql.Name)) is not running. Start it from the Services app, or run 'net start $($mysql.Name)' in an administrator PowerShell, then try again."
}
Write-Host "  $($mysql.Name) is running"

# 2. First-time setup checks
Write-Step 'Checking setup'
if (-not (Test-Path "$root\backend\.env")) { Stop-WithError 'backend\.env is missing. In backend\ run: npm install, then npm run init:env (see docs/INSTALLATION.md).' }
if (-not (Test-Path "$root\ai-service\.env")) { Stop-WithError 'ai-service\.env is missing. See docs/INSTALLATION.md.' }
$python = "$root\ai-service\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { Stop-WithError 'The AI service has no .venv yet. See docs/INSTALLATION.md, step "AI service".' }
foreach ($dir in 'backend', 'frontend') {
    if (-not (Test-Path "$root\$dir\node_modules")) {
        Write-Host "  Installing $dir packages (first run only)..."
        Push-Location "$root\$dir"
        npm install --no-fund --no-audit
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { Stop-WithError "npm install failed in $dir." }
    }
}
Write-Host '  Everything is installed'

# 3. Start the three services, skipping any that are already running
$services = @(
    # The AI service and API listen on 127.0.0.1; Vite answers on "localhost" (IPv6 on Windows).
    @{ Name = 'AI service'; Url = 'http://127.0.0.1:8000/health'; Dir = "$root\ai-service";
       Command = "& '$python' -m uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8000" },
    @{ Name = 'API'; Url = 'http://127.0.0.1:5000/api/health/ready'; Dir = "$root\backend"; Command = 'npm run dev' },
    @{ Name = 'Website'; Url = 'http://localhost:5180/'; Dir = "$root\frontend"; Command = 'npm run dev' }
)
Write-Step 'Starting services'
foreach ($s in $services) {
    if (Test-Url $s.Url) { Write-Host "  $($s.Name) is already running"; continue }
    $title = "FinTrack $($s.Name)"
    Start-Process powershell -WorkingDirectory $s.Dir -ArgumentList '-NoExit', '-Command',
        "`$Host.UI.RawUI.WindowTitle = '$title'; $($s.Command)"
    Write-Host "  $($s.Name) started in its own window"
}

# 4. Wait until all three answer
Write-Step 'Waiting for everything to be ready (up to 60 seconds)'
foreach ($s in $services) {
    $ready = $false
    for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
        $ready = Test-Url $s.Url
        if (-not $ready) { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { Stop-WithError "$($s.Name) did not start. Look at its window for the error." }
    Write-Host "  $($s.Name) is ready"
}

Write-Step 'Opening FinTrack'
Start-Process 'http://localhost:5180'
Write-Host @'

FinTrack is running at http://localhost:5180
  Demo user:     aarav.sharma@fintrack.demo
  Administrator: admin@fintrack.demo
  Demo password: see DEMO_PASSWORD in backend\scripts\seed-demo.js

To stop FinTrack, close the three "FinTrack ..." windows.
'@ -ForegroundColor Green
Read-Host 'Press Enter to close this window'
