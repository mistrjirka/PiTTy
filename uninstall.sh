#!/usr/bin/env sh
set -eu
INSTALL_DIR="${PITTY_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/pitty}"
BIN_DIR="${PITTY_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
rm -rf "$INSTALL_DIR"
rm -f "$BIN_DIR/pitty" "$BIN_DIR/pitty-resume"
printf 'Removed PiTTy from %s and %s/pitty. Optional Pi packages were left installed.\n' "$INSTALL_DIR" "$BIN_DIR"
