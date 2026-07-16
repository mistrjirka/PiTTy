#!/usr/bin/env sh
set -eu

REPO="${PITTY_REPO:-mistrjirka/PiTTy}"
VERSION="${PITTY_VERSION:-latest}"
INSTALL_DIR="${PITTY_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/pitty}"
BIN_DIR="${PITTY_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
PLUGIN_MODE="ask"
ASSUME_YES=0
ALLOW_PLUGIN_FAILURE=0
if [ "${PITTY_WITH_PLUGINS:-}" = "1" ]; then PLUGIN_MODE="yes"; fi
if [ "${PITTY_WITHOUT_PLUGINS:-}" = "1" ]; then PLUGIN_MODE="no"; fi

usage() {
  cat <<'EOF'
PiTTy installer for Linux and macOS

Usage: install.sh [options]
  --with-plugins          Install pi-subagents and @juicesharp/rpiv-todo
  --without-plugins       Skip optional Pi packages
  --yes                   Accept defaults without prompting
  --allow-plugin-failure  Exit successfully when only optional packages fail
  --version <version>     Install a release, for example 0.3.0 or v0.3.0
  --install-dir <path>    Application directory
  --bin-dir <path>        Wrapper directory
  --repo <owner/name>     GitHub repository
  -h, --help              Show this help

Environment equivalents: PITTY_REPO, PITTY_VERSION, PITTY_INSTALL_DIR, PITTY_BIN_DIR,
PITTY_WITH_PLUGINS=1, PITTY_WITHOUT_PLUGINS=1, and PITTY_LOG_DIR.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-plugins) PLUGIN_MODE="yes" ;;
    --without-plugins) PLUGIN_MODE="no" ;;
    --yes) ASSUME_YES=1 ;;
    --allow-plugin-failure) ALLOW_PLUGIN_FAILURE=1 ;;
    --version) shift; [ "$#" -gt 0 ] || { echo "error: --version needs a value" >&2; exit 64; }; VERSION="$1" ;;
    --install-dir) shift; [ "$#" -gt 0 ] || { echo "error: --install-dir needs a value" >&2; exit 64; }; INSTALL_DIR="$1" ;;
    --bin-dir) shift; [ "$#" -gt 0 ] || { echo "error: --bin-dir needs a value" >&2; exit 64; }; BIN_DIR="$1" ;;
    --repo) shift; [ "$#" -gt 0 ] || { echo "error: --repo needs a value" >&2; exit 64; }; REPO="$1" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "required command '$1' was not found. Install it and re-run this installer."; }

need curl
need tar
need node
need npm
need pi
NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="$(printf '%s' "$NODE_VERSION" | cut -d. -f1)"
NODE_MINOR="$(printf '%s' "$NODE_VERSION" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  die "Node.js 22.19.0 or newer is required; found $NODE_VERSION."
fi

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t pitty-install)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
LOG_DIR="${PITTY_LOG_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/pitty/install-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$LOG_DIR"

if [ "$VERSION" = "latest" ]; then
  say "Resolving the latest PiTTy release from $REPO..."
  RELEASE_JSON="$TMP/release.json"
  if ! curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" -o "$RELEASE_JSON"; then
    die "could not read the latest GitHub release for $REPO. The repository may not have a release yet, GitHub may be unavailable, or the repository name may be wrong."
  fi
  TAG="$(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!x.tag_name) process.exit(2); process.stdout.write(x.tag_name)' "$RELEASE_JSON")" || die "GitHub returned a release without tag_name. Response saved at $RELEASE_JSON"
else
  case "$VERSION" in v*) TAG="$VERSION" ;; *) TAG="v$VERSION" ;; esac
fi
VER="${TAG#v}"
ASSET="pitty-$VER.tar.gz"
URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
ARCHIVE="$TMP/$ASSET"

say "Downloading PiTTy $VER..."
if ! curl -fL --retry 3 --retry-delay 1 "$URL" -o "$ARCHIVE"; then
  die "download failed: $URL. Confirm that release $TAG contains $ASSET."
fi

CHECKSUMS="$TMP/SHA256SUMS"
if curl -fsSL "https://github.com/$REPO/releases/download/$TAG/SHA256SUMS" -o "$CHECKSUMS"; then
  EXPECTED="$(awk -v file="$ASSET" '$2==file {print $1}' "$CHECKSUMS" | head -n 1)"
  if [ -n "$EXPECTED" ]; then
    if command -v sha256sum >/dev/null 2>&1; then ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then ACTUAL="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
    else ACTUAL=""; warn "no sha256sum or shasum command; checksum was not verified"
    fi
    [ -z "$ACTUAL" ] || [ "$ACTUAL" = "$EXPECTED" ] || die "checksum mismatch for $ASSET (expected $EXPECTED, got $ACTUAL)"
  else
    warn "SHA256SUMS did not contain $ASSET"
  fi
else
  warn "release checksums were unavailable; continuing without checksum verification"
fi

SRC="$TMP/source"
mkdir -p "$SRC"
if ! tar -xzf "$ARCHIVE" -C "$SRC"; then die "could not extract $ARCHIVE"; fi
ROOT=""
for candidate in "$SRC"/*; do
  if [ -d "$candidate" ]; then ROOT="$candidate"; break; fi
done
[ -n "$ROOT" ] || die "release archive had no top-level directory"

say "Installing application files to $INSTALL_DIR..."
rm -rf "$INSTALL_DIR.new"
mkdir -p "$INSTALL_DIR.new"
cp -R "$ROOT"/. "$INSTALL_DIR.new"/

NPM_LOG="$LOG_DIR/npm-install.log"
if ! (cd "$INSTALL_DIR.new" && npm ci --ignore-scripts --no-audit --no-fund) >"$NPM_LOG" 2>&1; then
  printf 'error: npm dependency installation failed.\n' >&2
  printf '  command: cd %s && npm ci --ignore-scripts --no-audit --no-fund\n' "$INSTALL_DIR.new" >&2
  printf '  log: %s\n' "$NPM_LOG" >&2
  tail -n 30 "$NPM_LOG" >&2 || true
  exit 1
fi
BUN_LOG="$LOG_DIR/bun-install.log"
if ! (cd "$INSTALL_DIR.new" && node node_modules/bun/install.js) >"$BUN_LOG" 2>&1; then
  printf 'error: Bun runtime installation failed.\n' >&2
  printf '  command: cd %s && node node_modules/bun/install.js\n' "$INSTALL_DIR.new" >&2
  printf '  log: %s\n' "$BUN_LOG" >&2
  tail -n 30 "$BUN_LOG" >&2 || true
  exit 1
fi
rm -rf "$INSTALL_DIR"
mv "$INSTALL_DIR.new" "$INSTALL_DIR"

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/pitty" <<EOF
#!/usr/bin/env sh
exec node "$INSTALL_DIR/bin/pitty.mjs" "\$@"
EOF
chmod +x "$BIN_DIR/pitty"
cat > "$BIN_DIR/pitty-resume" <<EOF
#!/usr/bin/env sh
exec node "$INSTALL_DIR/bin/pitty-resume.mjs" "\$@"
EOF
chmod +x "$BIN_DIR/pitty-resume"

if [ "$PLUGIN_MODE" = "ask" ]; then
  if [ "$ASSUME_YES" -eq 1 ]; then
    PLUGIN_MODE="yes"
  elif [ -r /dev/tty ]; then
    printf 'Install recommended Pi packages?
  - pi-subagents: live child-agent inspection and steering
  - @juicesharp/rpiv-todo: Todo sidebar
Install both? [Y/n] ' >/dev/tty
    read answer </dev/tty || answer=""
    case "$answer" in n|N|no|NO) PLUGIN_MODE="no" ;; *) PLUGIN_MODE="yes" ;; esac
  else
    PLUGIN_MODE="no"
  fi
fi

PLUGIN_FAILURES=0
install_plugin() {
  spec="$1"; needle="$2"; log="$LOG_DIR/plugin-$(printf '%s' "$needle" | tr '/@' '__').log"
  if pi list 2>/dev/null | grep -F "$needle" >/dev/null 2>&1; then
    say "Optional Pi package already installed: $spec"
    return 0
  fi
  say "Installing optional Pi package: $spec"
  if pi install "$spec" >"$log" 2>&1; then
    say "Installed $spec"
  else
    code=$?
    PLUGIN_FAILURES=$((PLUGIN_FAILURES + 1))
    printf 'error: optional Pi package installation failed.\n' >&2
    printf '  package: %s\n  command: pi install %s\n  exit code: %s\n  log: %s\n' "$spec" "$spec" "$code" "$log" >&2
    tail -n 30 "$log" >&2 || true
    printf '  PiTTy itself is installed and will run without this integration.\n' >&2
  fi
}

if [ "$PLUGIN_MODE" = "yes" ]; then
  install_plugin "npm:pi-subagents" "pi-subagents"
  install_plugin "npm:@juicesharp/rpiv-todo" "@juicesharp/rpiv-todo"
else
  say "Skipping optional Pi packages. PiTTy will hide their panels and continue normally."
fi

say ""
say "PiTTy $VER installed."
say "Installer logs: $LOG_DIR"
say "Run: pitty -C /path/to/project --continue"
say "Resume picker: pitty-resume -C /path/to/project"
case ":${PATH:-}:" in *":$BIN_DIR:"*) : ;; *) warn "$BIN_DIR is not on PATH; add it to your shell profile or run $BIN_DIR/pitty" ;; esac

if [ "$PLUGIN_FAILURES" -gt 0 ] && [ "$ALLOW_PLUGIN_FAILURE" -ne 1 ]; then
  exit 2
fi
