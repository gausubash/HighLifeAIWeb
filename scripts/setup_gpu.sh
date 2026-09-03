#!/usr/bin/env bash
# Legacy entry point — delegates to setup-race.sh (repo GPU env only).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/setup-race.sh" --skip-apt --skip-vscode --skip-gh --skip-clone "$@"
