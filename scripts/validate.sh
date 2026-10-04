#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
exec "$root/template/.ledger/validate.sh" "${1:-.}"
