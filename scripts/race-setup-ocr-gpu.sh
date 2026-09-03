#!/usr/bin/env bash
# Deprecated wrapper — use race-setup-venv.sh (single .venv for GPU + OCR).
exec "$(dirname "${BASH_SOURCE[0]}")/race-setup-venv.sh" "$@"
