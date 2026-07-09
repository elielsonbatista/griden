#!/bin/sh
# Signs the binary with a stable local identity before running it, so the
# macOS Keychain "Always Allow" choice survives rebuilds (an ad-hoc/unsigned
# binary gets a new identity, and a new prompt, on every rebuild). No-ops if
# the identity isn't set up locally (see src-tauri/scripts/README.md).
set -eu

identity="${GRIDEN_CODESIGN_IDENTITY:-Griden Dev}"
bin="$1"
shift

if security find-identity -v -p codesigning | grep -q "\"$identity\""; then
  codesign --force --deep --sign "$identity" "$bin"
fi

exec "$bin" "$@"
