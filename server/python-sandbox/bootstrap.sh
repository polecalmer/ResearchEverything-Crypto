#!/bin/bash
# Bootstrap the Python sandbox venv used by the execute_python tool.
#
# What this does:
#   1. Creates a venv at server/python-sandbox/venv/
#   2. Installs a fixed whitelist of data-science libs:
#      pandas, numpy, scipy, statsmodels, scikit-learn, openpyxl, matplotlib
#   3. NOTHING else — the agent's Python code can ONLY import what's listed
#      (plus the stdlib). Adding a new lib means editing this file +
#      re-running bootstrap.
#
# Run once after pulling the repo (or whenever requirements.txt changes):
#
#   bash server/python-sandbox/bootstrap.sh
#
# Re-run is idempotent — `pip install -r` skips already-installed packages.
#
# Requirements: python3 (3.10+) on PATH. The venv is local to the repo
# so it doesn't pollute the host's site-packages.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

# Locate a usable python3
if command -v python3 >/dev/null 2>&1; then
    PYTHON=python3
elif command -v python >/dev/null 2>&1; then
    PYTHON=python
else
    echo "ERROR: python3 not found on PATH. Install Python 3.10+ then retry." >&2
    exit 1
fi

PY_VER=$("$PYTHON" -c "import sys; print('.'.join(map(str, sys.version_info[:2])))")
echo "Using python: $($PYTHON -V) at $(which $PYTHON)"

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating venv at $VENV_DIR..."
    "$PYTHON" -m venv "$VENV_DIR"
else
    echo "Venv already exists at $VENV_DIR — reusing."
fi

# Activate + upgrade pip
"$VENV_DIR/bin/pip" install --quiet --upgrade pip wheel

# Install the whitelist
echo "Installing whitelisted packages..."
"$VENV_DIR/bin/pip" install --quiet -r "$SCRIPT_DIR/requirements.txt"

echo ""
echo "Sandbox bootstrap complete. Venv: $VENV_DIR"
echo "Smoke test:"
"$VENV_DIR/bin/python3" -c "import pandas, numpy, scipy, statsmodels, sklearn, openpyxl; print('  ✓ all imports OK')"
