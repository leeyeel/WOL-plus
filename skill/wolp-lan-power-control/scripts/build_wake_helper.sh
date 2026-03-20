#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CC_BIN="${CC:-cc}"

"$CC_BIN" -O2 -Wall -Wextra \
    -o "$SCRIPT_DIR/wolp_wake_helper" \
    "$SCRIPT_DIR/wolp_wake_helper.c"

echo "Built wake helper: $SCRIPT_DIR/wolp_wake_helper"
echo "Grant capability if needed:"
echo "  sudo setcap cap_net_raw+ep $SCRIPT_DIR/wolp_wake_helper"
