#!/usr/bin/env bash
# Runs the fast tests (Django creates its own test database). Used as a gate by run-e1.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate 2>/dev/null || source .venv/Scripts/activate
pytest -m "not slow" "$@"
