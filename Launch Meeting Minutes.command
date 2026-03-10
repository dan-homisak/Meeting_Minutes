#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH."
  echo "Install Node.js from https://nodejs.org and try again."
  read -r "?Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting Meeting Minutes launcher..."

# Clean up any stale probe/headless sessions so normal launch opens a visible browser window.
pkill -9 -f "scripts/live-v4-probe-runner.mjs" >/dev/null 2>&1 || true
pkill -9 -f "mm-live-v4-probe-" >/dev/null 2>&1 || true

npm run launch
