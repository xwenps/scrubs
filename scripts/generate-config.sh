#!/bin/sh
# Local development: load .env and regenerate config/runtime-config.js.
#
#   cp .env.example .env && $EDITOR .env
#   ./scripts/generate-config.sh
#   python3 -m http.server 8000
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT/.env" ]; then
  # Export every assignment in .env without executing anything else in it.
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
else
  echo "scrubs: no .env found — copy .env.example to .env first." >&2
fi

"$ROOT/scripts/write-runtime-config.sh" "$ROOT/config/runtime-config.js"
