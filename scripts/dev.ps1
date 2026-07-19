# Pique dev launcher — starts backend + frontend, pings external services.
$repo = Split-Path -Parent $PSScriptRoot

Write-Host "== Pique dev ==" -ForegroundColor Cyan

# External service checks
foreach ($svc in @(
    @{ Name = "ComfyUI"; Url = "http://127.0.0.1:8188/system_stats" },
    @{ Name = "Ollama";  Url = "http://127.0.0.1:11434/api/tags" }
)) {
    try {
        Invoke-WebRequest -Uri $svc.Url -TimeoutSec 2 -UseBasicParsing | Out-Null
        Write-Host "  $($svc.Name): reachable" -ForegroundColor Green
    } catch {
        Write-Host "  $($svc.Name): NOT reachable (needed for generation features)" -ForegroundColor Yellow
    }
}

# Backend
$venvPython = Join-Path $repo "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "Backend venv missing — run: python -m venv backend\.venv; backend\.venv\Scripts\pip install -r backend\requirements.txt" -ForegroundColor Red
} else {
    Start-Process -FilePath $venvPython -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8010", "--reload" -WorkingDirectory (Join-Path $repo "backend")
    Write-Host "  Backend starting on http://localhost:8010 (docs at /docs)" -ForegroundColor Green
}

# TTS service — runs on the system Python 3.11 (same validated stack as Henty)
$ttsPython = Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe"
if (Test-Path $ttsPython) {
    Start-Process -FilePath $ttsPython -ArgumentList "-m", "uvicorn", "app:app", "--port", "8100" -WorkingDirectory (Join-Path $repo "services\tts")
    Write-Host "  TTS service starting on http://localhost:8100" -ForegroundColor Green
} else {
    Write-Host "  TTS service: system Python 3.11 not found" -ForegroundColor Yellow
}

# Frontend
if (Test-Path (Join-Path $repo "frontend\package.json")) {
    Start-Process -FilePath "cmd" -ArgumentList "/c", "npm run dev" -WorkingDirectory (Join-Path $repo "frontend")
    Write-Host "  Frontend starting on http://localhost:3000" -ForegroundColor Green
} else {
    Write-Host "  Frontend not scaffolded yet" -ForegroundColor Yellow
}
