#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
    echo 'Error: Python 3.9 or newer is required. Install Python first; see README.md for from-scratch setup.' >&2
    exit 1
fi
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))'; then
    echo 'Error: Python 3.9 or newer is required; see README.md for prerequisites.' >&2
    exit 1
fi
exec python3 "$SCRIPT_DIR/install.py" "$@"
