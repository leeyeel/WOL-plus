#!/bin/bash
# Build ipk packages for luci-app-wolp (x86_64 and aarch64)
#
# IPK 包说明：
# - 依赖 etherwake 包（需单独安装：opkg install etherwake）
# - 安装 wol.js 到 /www/luci-static/resources/view/
# - 安装 wol.zh-cn.lmo 到 /usr/lib/lua/luci/i18n/
#
# 打包格式：使用 tar.gz 格式（OpenWrt opkg 兼容）

set -e

# ==============================================================================
# 配置
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/ipk-build"
OUTPUT_DIR="$PROJECT_ROOT/release"

VERSION="${VERSION:-1.0.0}"
PACKAGE_NAME="luci-app-wolp"
# OpenWrt 架构命名: amd64->x86_64, arm64->aarch64
ARCHITECTURES=("x86_64" "aarch64")

# ==============================================================================
# 打印信息
# ==============================================================================

echo "=========================================="
echo "  Building luci-app-wolp ipk packages"
echo "  Version: $VERSION"
echo "  Architectures: ${ARCHITECTURES[*]}"
echo "  Format: tar.gz (OpenWrt opkg compatible)"
echo "=========================================="

# ==============================================================================
# 清理并创建输出目录
# ==============================================================================

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# ==============================================================================
# 构建函数
# ==============================================================================

build_ipk() {
    local ARCH=$1
    local PACKAGE_DIR="$BUILD_DIR/luci-app-wolp-$ARCH"
    local IPK_FILE="${PACKAGE_NAME}_${VERSION}_${ARCH}.ipk"

    echo ""
    echo "----------------------------------------"
    echo "Building for $ARCH..."
    echo "----------------------------------------"

    # --------------------------------------------------
    # 清理并创建目录结构
    # --------------------------------------------------
    rm -rf "$PACKAGE_DIR"
    mkdir -p "$PACKAGE_DIR/CONTROL"

    # --------------------------------------------------
    # 创建 CONTROL/control 文件
    # --------------------------------------------------
    cat > "$PACKAGE_DIR/CONTROL/control" << EOF
Package: luci-app-wolp
Version: $VERSION
Depends: libc, luci-compat, etherwake
Provides: luci-app-wolp
Section: luci
Architecture: $ARCH
Maintainer: leeyeel
Description: WOL+ - Remote wake and shutdown
 OpenWrt WOL+ application with Web UI support.
 Sends WOL Magic Packet with additional data to LAN devices.
EOF

    # --------------------------------------------------
    # 创建 CONTROL/postinst 脚本（安装后执行）
    # --------------------------------------------------
    cat > "$PACKAGE_DIR/CONTROL/postinst" << 'EOF'
#!/bin/sh
# Post-install script for luci-app-wolp

[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

. /lib/functions.sh

# 确保 i18n 目录存在
mkdir -p /usr/lib/lua/luci/i18n

# 设置文件权限
chmod 644 /www/luci-static/resources/view/wol.js 2>/dev/null || true
chmod 644 /usr/lib/lua/luci/i18n/wol.zh-cn.lmo 2>/dev/null || true

# 重启 LuCI (如果正在运行)
if [ -x /etc/init.d/uhttpd ]; then
    /etc/init.d/uhttpd reload 2>/dev/null || true
fi

echo "luci-app-wolp installed successfully!"
echo "Note: Make sure 'etherwake' is installed: opkg install etherwake"
exit 0
EOF

    # --------------------------------------------------
    # 创建 CONTROL/prerm 脚本（卸载前执行）
    # --------------------------------------------------
    cat > "$PACKAGE_DIR/CONTROL/prerm" << 'EOF'
#!/bin/sh
# Pre-remove script for luci-app-wolp

[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

echo "Removing luci-app-wolp..."
exit 0
EOF

    # --------------------------------------------------
    # 创建 CONTROL/postrm 脚本（卸载后执行）
    # --------------------------------------------------
    cat > "$PACKAGE_DIR/CONTROL/postrm" << 'EOF'
#!/bin/sh
# Post-remove script for luci-app-wolp

[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

# 删除已安装的文件
rm -f /www/luci-static/resources/view/wol.js
rm -f /usr/lib/lua/luci/i18n/wol.zh-cn.lmo

# 重启 LuCI (如果正在运行)
if [ -x /etc/init.d/uhttpd ]; then
    /etc/init.d/uhttpd reload 2>/dev/null || true
fi

exit 0
EOF

    # --------------------------------------------------
    # 设置脚本权限
    # --------------------------------------------------
    chmod 755 "$PACKAGE_DIR/CONTROL/postinst"
    chmod 755 "$PACKAGE_DIR/CONTROL/prerm"
    chmod 755 "$PACKAGE_DIR/CONTROL/postrm"

    # --------------------------------------------------
    # 拷贝文件到包目录结构
    # --------------------------------------------------
    echo "Copying files..."

    # LuCI JavaScript 文件 -> /www/luci-static/resources/view/
    mkdir -p "$PACKAGE_DIR/www/luci-static/resources/view"
    cp "$PROJECT_ROOT/openwrt/wol.js" \
       "$PACKAGE_DIR/www/luci-static/resources/view/wol.js"

    # 中文翻译文件 -> /usr/lib/lua/luci/i18n/
    mkdir -p "$PACKAGE_DIR/usr/lib/lua/luci/i18n"
    if [ -f "$PROJECT_ROOT/openwrt/wol.zh-cn.lmo" ]; then
        cp "$PROJECT_ROOT/openwrt/wol.zh-cn.lmo" \
           "$PACKAGE_DIR/usr/lib/lua/luci/i18n/wol.zh-cn.lmo"
    else
        echo "Warning: wol.zh-cn.lmo not found, skipping..."
    fi

    # --------------------------------------------------
    # 构建 IPK 包（tar.gz 格式）
    # --------------------------------------------------

    # 创建 debian-binary
    echo "2.0" > "$PACKAGE_DIR/debian-binary"

    # 创建 control.tar.gz (从 CONTROL 目录，需要 ./ 前缀)
    echo "Creating control.tar.gz..."
    cd "$PACKAGE_DIR/CONTROL"
    tar --numeric-owner --owner=0 --group=0 -czf "$BUILD_DIR/control.tar.gz" .
    cd "$PROJECT_ROOT"

    # 创建 data.tar.gz (从包根目录，排除 CONTROL 和 debian-binary)
    echo "Creating data.tar.gz..."
    cd "$PACKAGE_DIR"
    tar --numeric-owner --owner=0 --group=0 -czf "$BUILD_DIR/data.tar.gz" www usr 2>/dev/null || \
    tar --numeric-owner --owner=0 --group=0 -czf "$BUILD_DIR/data.tar.gz" www
    cd "$PROJECT_ROOT"

    # 复制 debian-binary 到 BUILD_DIR
    cp "$PACKAGE_DIR/debian-binary" "$BUILD_DIR/debian-binary"

    # 将 debian-binary, control.tar.gz, data.tar.gz 打包成 tar.gz 格式的 IPK
    echo "Building ipk package (tar.gz format)..."
    cd "$BUILD_DIR"
    tar --numeric-owner --owner=0 --group=0 -czf "$OUTPUT_DIR/$IPK_FILE" debian-binary control.tar.gz data.tar.gz
    cd "$PROJECT_ROOT"

    # --------------------------------------------------
    # 清理临时文件
    # --------------------------------------------------
    rm -rf "$BUILD_DIR/control.tar.gz" "$BUILD_DIR/data.tar.gz" "$BUILD_DIR/debian-binary"
    rm -rf "$PACKAGE_DIR"

    echo "Built: $OUTPUT_DIR/$IPK_FILE"
    ls -lh "$OUTPUT_DIR/$IPK_FILE"
}

# ==============================================================================
# 为每个架构构建 IPK 包
# ==============================================================================

for ARCH in "${ARCHITECTURES[@]}"; do
    build_ipk "$ARCH"
done

# ==============================================================================
# 构建完成
# ==============================================================================

echo ""
echo "=========================================="
echo "  All builds completed!"
echo "=========================================="
echo ""
echo "Generated packages:"
ls -lh "$OUTPUT_DIR/"*.ipk 2>/dev/null || echo "No IPK files found"
echo ""
echo "Install on OpenWrt:"
echo "  1. 安装 etherwake 依赖:"
echo "     opkg install etherwake"
echo ""
echo "  2. 拷贝 IPK 到 OpenWrt:"
echo "     scp ${PACKAGE_NAME}_*.ipk root@<openwrt-ip>:/tmp/"
echo ""
echo "  3. 安装 IPK:"
echo "     opkg install /tmp/${PACKAGE_NAME}_*.ipk"
echo ""
echo "  4. 卸载 IPK:"
echo "     opkg remove luci-app-wolp"
echo "=========================================="
