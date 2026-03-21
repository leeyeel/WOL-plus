#!/usr/bin/env bash

set -euo pipefail

usage() {
    echo "Usage: $0 [--without-webui] <amd64|arm64> [version]" >&2
}

INCLUDE_WEBUI=1
POSITIONAL=()
for arg in "$@"; do
    case "$arg" in
        --without-webui)
            INCLUDE_WEBUI=0
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            POSITIONAL+=("$arg")
            ;;
    esac
done
set -- "${POSITIONAL[@]}"

if [[ $# -lt 1 || $# -gt 2 ]]; then
    usage
    exit 1
fi

ARCH="$1"
VERSION="${2:-0.0.0-dev}"

case "$ARCH" in
    amd64|arm64) ;;
    *)
        echo "Unsupported architecture: $ARCH" >&2
        exit 1
        ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
if [[ "$INCLUDE_WEBUI" -eq 1 ]]; then
    VARIANT="with-webui"
    PKG_DESCRIPTION="UDP-based shutdown listener with bundled web UI for Wake On LAN Plus."
    OTHER_PKG_NAME="wolp-client-backend-only"
else
    VARIANT="backend-only"
    PKG_DESCRIPTION="UDP-based shutdown listener without bundled web UI for Wake On LAN Plus."
    OTHER_PKG_NAME="wolp-client-with-webui"
fi

BUILD_ROOT="$REPO_ROOT/build/deb/$ARCH/$VARIANT"
PKG_ROOT="$BUILD_ROOT/pkg"
BIN_DIR="$PKG_ROOT/usr/local/bin"
ETC_DIR="$PKG_ROOT/usr/local/etc/wolp"
WEBUI_DIR="$PKG_ROOT/usr/share/wolp/webui"
SYSTEMD_DIR="$PKG_ROOT/lib/systemd/system"
DEBIAN_DIR="$PKG_ROOT/DEBIAN"
OUTPUT_DIR="$REPO_ROOT/release/client"
PKG_NAME="wolp-client-$VARIANT"
PKG_FILE="$OUTPUT_DIR/${PKG_NAME}_${VERSION}_${ARCH}.deb"

rm -rf "$BUILD_ROOT"
mkdir -p "$BIN_DIR" "$ETC_DIR" "$SYSTEMD_DIR" "$DEBIAN_DIR" "$OUTPUT_DIR"
if [[ "$INCLUDE_WEBUI" -eq 1 ]]; then
    mkdir -p "$WEBUI_DIR"
fi

pushd "$REPO_ROOT/client/src" >/dev/null
GOOS=linux GOARCH="$ARCH" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$BIN_DIR/wolp" .
popd >/dev/null

install -m 0644 "$REPO_ROOT/client/wolp.json" "$ETC_DIR/wolp.json"
if [[ "$INCLUDE_WEBUI" -eq 1 ]]; then
    cp -R "$REPO_ROOT/client/webui/." "$WEBUI_DIR/"
    install -m 0644 "$REPO_ROOT/client/systemd/wolp.service" "$SYSTEMD_DIR/wolp.service"
else
    sed 's#^ExecStart=/usr/local/bin/wolp$#ExecStart=/usr/local/bin/wolp --backend-only#' \
        "$REPO_ROOT/client/systemd/wolp.service" > "$SYSTEMD_DIR/wolp.service"
    chmod 0644 "$SYSTEMD_DIR/wolp.service"
fi

cat > "$DEBIAN_DIR/control" <<EOF
Package: $PKG_NAME
Version: $VERSION
Section: net
Priority: optional
Architecture: $ARCH
Maintainer: leeyeel <mumuli52@gmail.com>
Depends: systemd
Provides: wolp-client
Conflicts: $OTHER_PKG_NAME
Replaces: $OTHER_PKG_NAME
Description: Wake On LAN Plus client
 $PKG_DESCRIPTION
EOF

cat > "$DEBIAN_DIR/conffiles" <<EOF
/usr/local/etc/wolp/wolp.json
EOF

cat > "$DEBIAN_DIR/postinst" <<'EOF'
#!/bin/sh
set -e

systemctl daemon-reload >/dev/null 2>&1 || true
systemctl enable wolp.service >/dev/null 2>&1 || true
systemctl restart wolp.service >/dev/null 2>&1 || true
EOF

cat > "$DEBIAN_DIR/prerm" <<'EOF'
#!/bin/sh
set -e

if [ "$1" = "remove" ] || [ "$1" = "deconfigure" ]; then
    systemctl stop wolp.service >/dev/null 2>&1 || true
    systemctl disable wolp.service >/dev/null 2>&1 || true
fi
EOF

chmod 0755 "$DEBIAN_DIR/postinst" "$DEBIAN_DIR/prerm"

dpkg-deb --build "$PKG_ROOT" "$PKG_FILE" >/dev/null
echo "Built Debian package: $PKG_FILE"
