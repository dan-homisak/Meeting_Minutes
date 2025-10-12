# Requires PowerShell 5+

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Join-Path $ProjectRoot ".."
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$VenvPath = Join-Path $ProjectRoot ".venv"
$GitIgnorePath = Join-Path $ProjectRoot ".gitignore"

Write-Host "[setup] Project root: $ProjectRoot"

$Python = Get-Command python -ErrorAction SilentlyContinue
if (-not $Python) {
    $Python = Get-Command python3 -ErrorAction SilentlyContinue
}

if (-not $Python) {
    Write-Error "python or python3 not found. Install Python 3.10+ and rerun scripts\setup.ps1."
    exit 1
}

if (-not (Test-Path $VenvPath)) {
    Write-Host "[setup] Creating virtual environment at $VenvPath"
    & $Python.Source -m venv $VenvPath
} else {
    Write-Host "[setup] Virtual environment already exists at $VenvPath"
}

$ActivateScript = Join-Path $VenvPath "Scripts\Activate.ps1"
. $ActivateScript

function Ensure-GitIgnore {
    param([string]$Path)

    $template = @"
# macOS metadata
.DS_Store

# Python virtual environment
.venv/

# Application logs
*.log

# SQLite database file
backend/app.db

# PyInstaller build artifacts and distributables
build/
dist/
*.spec

# Python bytecode cache
__pycache__/
*.pyc

# Node/Yarn caches (if you later add a bundler)
node_modules/
.parcel-cache/
.npm/
.yarn/

# IDE/project workspace files (add more as needed)
.vscode/
.idea/
*.sublime-project
*.sublime-workspace
"@

    if (-not (Test-Path $Path)) {
        Write-Host "[setup] Creating .gitignore with default patterns"
        $template | Out-File -FilePath $Path -Encoding UTF8
        return
    }

    Write-Host "[setup] Ensuring .gitignore contains recommended patterns"
    $lines = Get-Content $Path
    $templateLines = $template -split "`n"

    foreach ($pattern in $templateLines) {
        if ($pattern -eq "") {
            if ($lines.Count -eq 0 -or $lines[-1] -ne "") {
                Add-Content -Path $Path -Value ""
            }
            $lines = Get-Content $Path
            continue
        }

        if (-not ($lines -contains $pattern)) {
            Add-Content -Path $Path -Value $pattern
            $lines = Get-Content $Path
        }
    }
}

Write-Host "[setup] Upgrading pip"
python -m pip install --upgrade pip setuptools wheel | Out-Null

Write-Host "[setup] Installing Python dependencies"
python -m pip install -r (Join-Path $ProjectRoot "requirements.txt")

Write-Host "[setup] Vendoring React UMD builds"
python (Join-Path $ProjectRoot "scripts\vendor_react.py")
if ($LASTEXITCODE -ne 0) {
    Write-Host "[setup] Vendoring script reported an error; CDN fallback will be used."
}

Write-Host "[setup] Checking for outdated Python packages (informational)"
python -m pip list --outdated
if ($LASTEXITCODE -ne 0) {
    Write-Host "[setup] Unable to list outdated packages (this is non-fatal)."
}

Ensure-GitIgnore -Path $GitIgnorePath

Write-Host "[setup] Done. Activate later with:"
Write-Host "  .\.venv\Scripts\Activate.ps1"
