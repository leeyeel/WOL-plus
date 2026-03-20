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
RAW_VERSION="${2:-0.0.0-dev}"

case "$ARCH" in
    amd64)
        GO_ARCH="amd64"
        RPM_ARCH="x86_64"
        ;;
    arm64)
        GO_ARCH="arm64"
        RPM_ARCH="aarch64"
        ;;
    *)
        echo "Unsupported architecture: $ARCH" >&2
        exit 1
        ;;
esac

sanitize_rpm_segment() {
    local value="$1"
    value="${value//[^A-Za-z0-9._+~]/.}"
    value="${value#.}"
    value="${value%.}"
    while [[ "$value" == *".."* ]]; do
        value="${value//../.}"
    done
    printf '%s' "$value"
}

split_rpm_version() {
    local raw="$1"
    local version_part release_suffix rpm_version rpm_release

    if [[ "$raw" == *-* ]]; then
        version_part="${raw%%-*}"
        release_suffix="${raw#*-}"
    else
        version_part="$raw"
        release_suffix=""
    fi

    rpm_version="$(sanitize_rpm_segment "$version_part")"
    if [[ -z "$rpm_version" ]]; then
        rpm_version="0.0.0"
    fi

    if [[ -n "$release_suffix" ]]; then
        release_suffix="$(sanitize_rpm_segment "$release_suffix")"
        rpm_release="0.1.${release_suffix}"
    else
        rpm_release="1"
    fi

    printf '%s\n%s\n' "$rpm_version" "$rpm_release"
}

mapfile -t RPM_VERSION_INFO < <(split_rpm_version "$RAW_VERSION")
RPM_VERSION="${RPM_VERSION_INFO[0]}"
RPM_RELEASE="${RPM_VERSION_INFO[1]}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_ROOT="$REPO_ROOT/build/rpm/$ARCH"
RPMBUILD_ROOT="$BUILD_ROOT/rpmbuild"
STAGE_ROOT="$BUILD_ROOT/stage"
BIN_DIR="$STAGE_ROOT/usr/local/bin"
CONFIG_DIR="$STAGE_ROOT/usr/local/etc/wolp"
WEBUI_DIR="$STAGE_ROOT/usr/share/wolp/webui"
SYSTEMD_DIR="$STAGE_ROOT/usr/lib/systemd/system"
OUTPUT_DIR="$REPO_ROOT/release/client"
SPEC_FILE="$RPMBUILD_ROOT/SPECS/wolp-client.spec"

rm -rf "$BUILD_ROOT"
mkdir -p \
    "$BIN_DIR" \
    "$CONFIG_DIR" \
    "$SYSTEMD_DIR" \
    "$OUTPUT_DIR" \
    "$RPMBUILD_ROOT/BUILD" \
    "$RPMBUILD_ROOT/BUILDROOT" \
    "$RPMBUILD_ROOT/RPMS" \
    "$RPMBUILD_ROOT/SOURCES" \
    "$RPMBUILD_ROOT/SPECS" \
    "$RPMBUILD_ROOT/SRPMS"
if [[ "$INCLUDE_WEBUI" -eq 1 ]]; then
    mkdir -p "$WEBUI_DIR"
fi

pushd "$REPO_ROOT/client/src" >/dev/null
GOOS=linux GOARCH="$GO_ARCH" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$BIN_DIR/wolp" .
popd >/dev/null

install -m 0644 "$REPO_ROOT/client/wolp.json" "$CONFIG_DIR/wolp.json"
if [[ "$INCLUDE_WEBUI" -eq 1 ]]; then
    cp -R "$REPO_ROOT/client/webui/." "$WEBUI_DIR/"
    install -m 0644 "$REPO_ROOT/client/systemd/wolp.service" "$SYSTEMD_DIR/wolp.service"
else
    sed 's#^ExecStart=/usr/local/bin/wolp$#ExecStart=/usr/local/bin/wolp --backend-only#' \
        "$REPO_ROOT/client/systemd/wolp.service" > "$SYSTEMD_DIR/wolp.service"
    chmod 0644 "$SYSTEMD_DIR/wolp.service"
fi

RPM_WEBUI_INSTALL_BLOCK=""
RPM_WEBUI_FILES_BLOCK=""
if [[ "$INCLUDE_WEBUI" -eq 1 ]]; then
    RPM_WEBUI_INSTALL_BLOCK=$(cat <<EOF
install -d %{buildroot}/usr/share/wolp
cp -a "$STAGE_ROOT/usr/share/wolp" %{buildroot}/usr/share/
EOF
)
    RPM_WEBUI_FILES_BLOCK="/usr/share/wolp"
fi

cat > "$SPEC_FILE" <<EOF
%global debug_package %{nil}

Name:           wolp-client
Version:        $RPM_VERSION
Release:        $RPM_RELEASE%{?dist}
Summary:        Wake On LAN Plus client
License:        MIT
Requires:       systemd

%description
UDP-based shutdown listener with optional web UI for Wake On LAN Plus.

%prep
:

%build
:

%install
rm -rf %{buildroot}
install -d %{buildroot}/usr/local/bin
install -d %{buildroot}/usr/local/etc/wolp
install -d %{buildroot}/usr/lib/systemd/system
install -m 0755 "$BIN_DIR/wolp" %{buildroot}/usr/local/bin/wolp
install -m 0644 "$CONFIG_DIR/wolp.json" %{buildroot}/usr/local/etc/wolp/wolp.json
$RPM_WEBUI_INSTALL_BLOCK
install -m 0644 "$SYSTEMD_DIR/wolp.service" %{buildroot}/usr/lib/systemd/system/wolp.service

%files
%defattr(-,root,root,-)
%config(noreplace) /usr/local/etc/wolp/wolp.json
/usr/local/bin/wolp
$RPM_WEBUI_FILES_BLOCK
/usr/lib/systemd/system/wolp.service

%post
systemctl daemon-reload >/dev/null 2>&1 || :
systemctl enable wolp.service >/dev/null 2>&1 || :
systemctl restart wolp.service >/dev/null 2>&1 || :

%preun
if [ \$1 -eq 0 ]; then
    systemctl stop wolp.service >/dev/null 2>&1 || :
    systemctl disable wolp.service >/dev/null 2>&1 || :
fi

%postun
systemctl daemon-reload >/dev/null 2>&1 || :
EOF

rpmbuild --target "$RPM_ARCH" --define "_topdir $RPMBUILD_ROOT" -bb "$SPEC_FILE" >/dev/null

find "$RPMBUILD_ROOT/RPMS" -type f -name '*.rpm' -exec cp {} "$OUTPUT_DIR/" \;
echo "Built RPM package(s):"
find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'wolp-client-*.rpm' -print | sort
