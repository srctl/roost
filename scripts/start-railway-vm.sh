#!/bin/sh
# Source deployment on a dedicated persistent Railway Cloud Agent VM.
set -eu
[ "$(id -u)" -ne 0 ] || { echo "Run Roost as a non-root user." >&2; exit 1; }
: "${ROOST_DATA_DIR:?Set ROOST_DATA_DIR to the persistent directory used for auth setup}"
[ -f "$ROOST_DATA_DIR/auth.sqlite" ] || {
  echo "Run native auth setup with this ROOST_DATA_DIR before exposing Roost." >&2
  exit 1
}
export HOST=0.0.0.0
export PORT="${PORT:-8080}"
exec node .output/server/index.mjs
