#!/bin/sh
set -eu
cd "$(dirname "$0")"

if [ -z "${CTVS_KUPO_BINARY:-}" ]; then
  if ! CTVS_KUPO_BINARY="$(command -v kupo)"; then
    echo "Kupo executable was not found on PATH" >&2
    exit 1
  fi
fi

export CTVS_KUPO_BINARY
exec node --import tsx src/main.ts "$@"
