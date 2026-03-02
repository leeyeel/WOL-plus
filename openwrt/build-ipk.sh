#!/bin/bash
# Build ipk packages for luci-app-wolp (amd64 and arm64)

set -e

# 项目根目录 (脚本在 openwrt 目录下，所以需要返回上一级)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/ipk-build"
OUTPUT_DIR="$PROJECT_ROOT/release"

# 版本号 (可通过环境变量 VERSION 传入，默认为 1.0.0)
VERSION="${VERSION:-1.0.0}"
PACKAGE_NAME="luci-app-wolp"

# 要构建的架构列表
ARCHITECTURES=("amd64" "arm64")

echo "=========================================="
echo "  Building luci-app-wolp ipk packages"
echo "  Version: $VERSION"
echo "  Architectures: ${ARCHITECTURES[*]}"
echo "=========================================="

# 清理并创建输出目录
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# 构建函数
build_ipk() {
    local ARCH=$1
    local PACKAGE_DIR="$BUILD_DIR/luci-app-wolp-$ARCH"
    local IPK_FILE="${PACKAGE_NAME}_${VERSION}_${ARCH}.ipk"

    echo ""
    echo "----------------------------------------"
    echo "Building for $ARCH..."
    echo "----------------------------------------"

    # 清理并创建目录
    rm -rf "$PACKAGE_DIR"
    mkdir -p "$PACKAGE_DIR/CONTROL"

    # 创建 CONTROL/control 文件
    cat > "$PACKAGE_DIR/CONTROL/control" << EOF
Package: luci-app-wolp
Version: $VERSION
Depends: libc, +luci-compat +etherwake
Provides: luci-app-wolp
Section: luci
Architecture: $ARCH
Maintainer: leeyeel
Description: Wake On LAN Plus - 远程唤醒和关机
 OpenWrt 路由器端的 WOL+ 应用，支持通过 Web UI
 发送带附加数据的 WOL Magic Packet 到局域网内的设备。
EOF

    # 创建 CONTROL/postinst 脚本
    cat > "$PACKAGE_DIR/CONTROL/postinst" << 'EOF'
#!/bin/sh
# Post-install script for luci-app-wolp

# 确保 i18n 目录存在
mkdir -p /usr/lib/lua/luci/i18n

# 设置权限
chmod 644 /www/luci-static/resources/view/wol.js 2>/dev/null || true
chmod 644 /usr/lib/lua/luci/i18n/wol.zh-cn.lmo 2>/dev/null || true

echo "luci-app-wolp installed successfully!"
exit 0
EOF

    # 创建 CONTROL/prerm 脚本
    cat > "$PACKAGE_DIR/CONTROL/prerm" << 'EOF'
#!/bin/sh
# Pre-remove script for luci-app-wolp

echo "Removing luci-app-wolp..."
exit 0
EOF

    # 设置脚本权限
    chmod 755 "$PACKAGE_DIR/CONTROL/postinst"
    chmod 755 "$PACKAGE_DIR/CONTROL/prerm"

    # 创建文件系统结构
    echo "Copying files..."

    # LuCI JavaScript 文件
    mkdir -p "$PACKAGE_DIR/www/luci-static/resources/view"
    cp "$PROJECT_ROOT/openwrt/wol.js" "$PACKAGE_DIR/www/luci-static/resources/view/wol.js"

    # 中文翻译文件
    mkdir -p "$PACKAGE_DIR/usr/lib/lua/luci/i18n"
    if [ -f "$PROJECT_ROOT/openwrt/wol.zh-cn.lmo" ]; then
        cp "$PROJECT_ROOT/openwrt/wol.zh-cn.lmo" "$PACKAGE_DIR/usr/lib/lua/luci/i18n/wol.zh-cn.lmo"
    else
        echo "Warning: wol.zh-cn.lmo not found, skipping..."
    fi

    # 创建 data.tar.gz
    echo "Creating data.tar.gz..."
    cd "$PACKAGE_DIR"
    tar czf "$BUILD_DIR/data-$ARCH.tar.gz" www usr
    cd "$PROJECT_ROOT"

    # 创建 control.tar.gz
    echo "Creating control.tar.gz..."
    cd "$PACKAGE_DIR/CONTROL"
    tar czf "$BUILD_DIR/control-$ARCH.tar.gz" ./*
    cd "$PROJECT_ROOT"

    # 创建 debian-binary
    echo "2.0" > "$BUILD_DIR/debian-binary"

    # 构建 ipk 包
    echo "Building ipk package..."
    cd "$BUILD_DIR"
    ar r "$OUTPUT_DIR/$IPK_FILE" debian-binary control-$ARCH.tar.gz data-$ARCH.tar.gz
    cd "$PROJECT_ROOT"

    # 清理临时文件
    rm -rf "$BUILD_DIR/data-$ARCH.tar.gz" "$BUILD_DIR/control-$ARCH.tar.gz" "$BUILD_DIR/debian-binary"
    rm -rf "$PACKAGE_DIR"

    echo "Built: $OUTPUT_DIR/$IPK_FILE"
    ls -lh "$OUTPUT_DIR/$IPK_FILE"
}

# 为每个架构构建 IPK 包
for ARCH in "${ARCHITECTURES[@]}"; do
    build_ipk "$ARCH"
done

echo ""
echo "=========================================="
echo "  All builds completed!"
echo "=========================================="
echo ""
echo "Generated packages:"
ls -lh "$OUTPUT_DIR/"*.ipk 2>/dev/null || echo "No IPK files found"
echo ""
echo "Install on OpenWrt:"
echo "  1. Copy ipk file to OpenWrt:"
echo "     scp ${PACKAGE_NAME}_*.ipk root@<openwrt-ip>:/tmp/"
echo ""
echo "  2. Install on OpenWrt:"
echo "     opkg install /tmp/${PACKAGE_NAME}_*.ipk"
echo ""
echo "  3. Remove package:"
echo "     opkg remove luci-app-wolp"
echo "=========================================="
