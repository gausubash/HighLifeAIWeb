# Install GPU PaddleOCR-VL on RACE — delegates to unified venv setup.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "race:fix-ocr -> race:fix-venv (single .venv on RACE)" -ForegroundColor Yellow
& (Join-Path $PSScriptRoot "race-fix-venv.ps1")
