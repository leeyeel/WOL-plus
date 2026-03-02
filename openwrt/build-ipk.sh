#!/bin/bash
# Build ipk packages for luci-app-wolp (amd64 and arm64)
#
# IPK 包说明：
# - 依赖 etherwake 包（需单独安装：opkg install etherwake）
# - 安装 wol.js 到 /www/luci-static/resources/view/
# - 安装 wol.zh-cn.lmo 到 /usr/lib/lua/luci/i18n/

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
ARCHITECTURES=("amd64" "arm64")

# ==============================================================================
# 打印信息
# ==============================================================================

echo "=========================================="
echo "  Building luci-app-wolp ipk packages"
echo "  Version: $VERSION"
echo "  Architectures: ${ARCHITECTURES[*]}"
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
Depends: libc, +luci-compat, +etherwake
Provides: luci-app-wolp
Section: luci
Architecture: $ARCH
Maintainer: leeyeel
Description: Wake On LAN Plus - 远程唤醒和关机
 OpenWrt 路由器端的 WOL+ 应用，支持通过 Web UI
 发送带附加数据的 WOL Magic Packet 到局域网内的设备。
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
    # 构建 IPK 包
    # --------------------------------------------------

    # 创建 data.tar.gz (包含 www/ 和 usr/)
    echo "Creating data.tar.gz..."
    cd "$PACKAGE_DIR"
    tar czf "$BUILD_DIR/data.tar.gz" www usr
    cd "$PROJECT_ROOT"

    # 创建 control.tar.gz (包含 CONTROL/ 目录下的所有文件)
    echo "Creating control.tar.gz..."
    cd "$PACKAGE_DIR/CONTROL"
    tar czf "$BUILD_DIR/control.tar.gz" .
    cd "$PROJECT_ROOT"

    # 创建 debian-binary
    echo "2.0" > "$BUILD_DIR/debian-binary"

    # 使用 ar 命令打包成 .ipk
    echo "Building ipk package..."
    cd "$BUILD_DIR"
    ar r "$OUTPUT_DIR/$IPK_FILE" debian-binary control.tar.gz data.tar.gz
    cd "$PROJECT_ROOT"

    # --------------------------------------------------
    # 清理临时文件
    # --------------------------------------------------
    rm -rf "$BUILD_DIR/data.tar.gz" \
            "$BUILD_DIR/control.tar.gz" \
            "$BUILD_DIR/debian-binary" \
            "$PACKAGE_DIR"

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
