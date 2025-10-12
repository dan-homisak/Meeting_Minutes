#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${PROJECT_ROOT}/.venv"
GITIGNORE="${PROJECT_ROOT}/.gitignore"

info() {
  printf '[setup] %s\n' "$*"
}

ensure_gitignore() {
  local patterns=(
    "# macOS metadata"
    ".DS_Store"
    ""
    "# Python virtual environment"
    ".venv/"
    ""
    "# Application logs"
    "*.log"
    ""
    "# SQLite database file"
    "backend/app.db"
    ""
    "# PyInstaller build artifacts and distributables"
    "build/"
    "dist/"
    "*.spec"
    ""
    "# Python bytecode cache"
    "__pycache__/"
    "*.pyc"
    ""
    "# Node/Yarn caches (if you later add a bundler)"
    "node_modules/"
    ".parcel-cache/"
    ".npm/"
    ".yarn/"
    ""
    "# IDE/project workspace files (add more as needed)"
    ".vscode/"
    ".idea/"
    "*.sublime-project"
    "*.sublime-workspace"
  )

  if [[ ! -f "${GITIGNORE}" ]]; then
    info "Creating .gitignore with default patterns"
    printf '%s\n' "${patterns[@]}" >"${GITIGNORE}"
    return
  fi

  info "Ensuring .gitignore contains recommended patterns"
  local pattern
  for pattern in "${patterns[@]}"; do
    if [[ -z "${pattern}" ]]; then
      if [[ "$(tail -n 1 "${GITIGNORE}" 2>/dev/null)" != "" ]]; then
        echo "" >>"${GITIGNORE}"
      fi
      continue
    fi

    if ! grep -qxF "${pattern}" "${GITIGNORE}"; then
      echo "${pattern}" >>"${GITIGNORE}"
    fi
  done
}

if [[ ! -x "$(command -v python3)" ]]; then
  echo "python3 not found. Install Python 3.10+ and rerun scripts/setup.sh." >&2
  exit 1
fi

PYTHON_BIN="$(command -v python3)"

if [[ ! -d "${VENV_DIR}" ]]; then
  info "Creating virtual environment at ${VENV_DIR}"
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
else
  info "Virtual environment already exists at ${VENV_DIR}"
fi

source "${VENV_DIR}/bin/activate"

info "Upgrading pip"
python -m pip install --upgrade pip setuptools wheel >/dev/null

info "Installing Python dependencies"
python -m pip install -r "${PROJECT_ROOT}/requirements.txt"

info "Vendoring React UMD builds"
if ! python "${PROJECT_ROOT}/scripts/vendor_react.py"; then
  info "Vendoring script reported an error; CDN fallback will be used."
fi

info "Checking for outdated Python packages (informational)"
if ! python -m pip list --outdated; then
  info "Unable to list outdated packages (this is non-fatal)."
fi

ensure_gitignore

info "Setup complete. Activate the environment with:"
printf '  source .venv/bin/activate\n'
