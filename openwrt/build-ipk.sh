#!/bin/bash
# Build ipk packages for luci-app-wolp (multiple architectures)
#
# IPK 包说明：
# - 依赖 luci-base、etherwake 和 netcat 包
# - 使用标准 LuCI 应用结构
# - 支持中文翻译
# - 支持多架构打包
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
SOURCE_DIR="$SCRIPT_DIR/luci-app-wolp"

VERSION="${VERSION:-1.0.0}"
PACKAGE_NAME="luci-app-wolp"
# 支持的架构
ARCHITECTURES=("x86_64" "aarch64_generic")

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
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ==============================================================================
# 构建函数
# ==============================================================================

build_ipk() {
    local ARCH=$1
    local PACKAGE_DIR="$BUILD_DIR/package-$ARCH"
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
Depends: libc, luci-base, etherwake, netcat
Section: luci
Architecture: $ARCH
Maintainer: leeyeel <mumuli52@gmail.com>
Description: LuCI Support for Wake-on-LAN Plus
 Wake on LAN Plus is a mechanism to boot and shutdown computers remotely.
 Supports multiple targets configuration with etherwake for wake and netcat for shutdown.
EOF

    # --------------------------------------------------
    # 创建 CONTROL/postinst 脚本（安装后执行）
    # --------------------------------------------------
    cat > "$PACKAGE_DIR/CONTROL/postinst" << 'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

# 重启 rpcd 服务以加载新的 RPC 接口
/etc/init.d/rpcd restart 2>/dev/null || true

# 重启 uhttpd 以加载新的 LuCI 模块
/etc/init.d/uhttpd restart 2>/dev/null || true

echo "luci-app-wolp installed successfully!"
echo "Access via: Services -> Wake on LAN Plus"
exit 0
EOF

    # --------------------------------------------------
    # 创建 CONTROL/prerm 脚本（卸载前执行）
    # --------------------------------------------------
    cat > "$PACKAGE_DIR/CONTROL/prerm" << 'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0
echo "Removing luci-app-wolp..."
exit 0
EOF

    # --------------------------------------------------
    # 创建 CONTROL/postrm 脚本（卸载后执行）
    # --------------------------------------------------
    cat > "$PACKAGE_DIR/CONTROL/postrm" << 'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

# 重启服务
/etc/init.d/rpcd restart 2>/dev/null || true
/etc/init.d/uhttpd restart 2>/dev/null || true

echo "luci-app-wolp removed successfully!"
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

    # 1. LuCI JavaScript 文件
    mkdir -p "$PACKAGE_DIR/www/luci-static/resources/view"
    cp "$SOURCE_DIR/htdocs/luci-static/resources/view/wolp.js" \
       "$PACKAGE_DIR/www/luci-static/resources/view/"

    # 2. UCI 配置文件
    mkdir -p "$PACKAGE_DIR/etc/config"
    cp "$SOURCE_DIR/root/etc/config/luci-wolp" \
       "$PACKAGE_DIR/etc/config/"

    # 3. LuCI 菜单配置
    mkdir -p "$PACKAGE_DIR/usr/share/luci/menu.d"
    cp "$SOURCE_DIR/root/usr/share/luci/menu.d/luci-app-wolp.json" \
       "$PACKAGE_DIR/usr/share/luci/menu.d/"

    # 4. RPCD ACL 配置
    mkdir -p "$PACKAGE_DIR/usr/share/rpcd/acl.d"
    cp "$SOURCE_DIR/root/usr/share/rpcd/acl.d/luci-app-wolp.json" \
       "$PACKAGE_DIR/usr/share/rpcd/acl.d/"

    # 5. RPCD ucode 脚本
    mkdir -p "$PACKAGE_DIR/usr/share/rpcd/ucode"
    cp "$SOURCE_DIR/root/usr/share/rpcd/ucode/luci.wolp" \
       "$PACKAGE_DIR/usr/share/rpcd/ucode/"
    chmod 755 "$PACKAGE_DIR/usr/share/rpcd/ucode/luci.wolp"

    # 6. 编译翻译文件
    echo "Compiling translation files..."
    mkdir -p "$PACKAGE_DIR/usr/lib/lua/luci/i18n"

    # 编译简体中文翻译
    if [ -f "$SOURCE_DIR/po/zh_Hans/wol.po" ]; then
        "$SCRIPT_DIR/po2lmo" "$SOURCE_DIR/po/zh_Hans/wol.po" \
            "$PACKAGE_DIR/usr/lib/lua/luci/i18n/wol.zh-cn.lmo"
        echo "  - Compiled zh_Hans translation"
    fi

    # 编译繁体中文翻译
    if [ -f "$SOURCE_DIR/po/zh_Hant/wol.po" ]; then
        "$SCRIPT_DIR/po2lmo" "$SOURCE_DIR/po/zh_Hant/wol.po" \
            "$PACKAGE_DIR/usr/lib/lua/luci/i18n/wol.zh-tw.lmo"
        echo "  - Compiled zh_Hant translation"
    fi

    # --------------------------------------------------
    # 构建 IPK 包（tar.gz 格式）
    # --------------------------------------------------

    # 创建 debian-binary
    echo "2.0" > "$PACKAGE_DIR/debian-binary"

    # 创建 control.tar.gz
    echo "Creating control.tar.gz..."
    cd "$PACKAGE_DIR/CONTROL"
    tar --numeric-owner --owner=0 --group=0 -czf "$BUILD_DIR/control-$ARCH.tar.gz" .
    cd "$SCRIPT_DIR"

    # 创建 data.tar.gz
    echo "Creating data.tar.gz..."
    cd "$PACKAGE_DIR"
    tar --numeric-owner --owner=0 --group=0 -czf "$BUILD_DIR/data-$ARCH.tar.gz" \
        www etc usr 2>/dev/null || true
    cd "$SCRIPT_DIR"

    # 复制 debian-binary
    cp "$PACKAGE_DIR/debian-binary" "$BUILD_DIR/debian-binary-$ARCH"

    # 打包成 IPK
    echo "Building ipk package (tar.gz format)..."
    cd "$BUILD_DIR"
    tar --numeric-owner --owner=0 --group=0 -czf "$OUTPUT_DIR/$IPK_FILE" \
        debian-binary-$ARCH control-$ARCH.tar.gz data-$ARCH.tar.gz
    cd "$SCRIPT_DIR"

    # 重命名内部文件（去掉架构后缀）
    cd "$OUTPUT_DIR"
    mkdir -p "tmp-$ARCH"
    cd "tmp-$ARCH"
    tar -xzf "../$IPK_FILE"
    mv "debian-binary-$ARCH" "debian-binary"
    mv "control-$ARCH.tar.gz" "control.tar.gz"
    mv "data-$ARCH.tar.gz" "data.tar.gz"
    tar --numeric-owner --owner=0 --group=0 -czf "../$IPK_FILE" \
        debian-binary control.tar.gz data.tar.gz
    cd "$OUTPUT_DIR"
    rm -rf "tmp-$ARCH"
    cd "$SCRIPT_DIR"

    # --------------------------------------------------
    # 清理临时文件
    # --------------------------------------------------
    rm -rf "$BUILD_DIR/control-$ARCH.tar.gz" "$BUILD_DIR/data-$ARCH.tar.gz" "$BUILD_DIR/debian-binary-$ARCH"
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
echo "Architecture guide:"
echo "  - all: 架构无关（推荐，适用所有平台）"
echo "  - x86_64: Intel/AMD 64位 PC"
echo "  - aarch64_generic: ARM 64位（树莓派4、NanoPi等）"
echo "  - arm_cortex-a9: ARM 32位（树莓派2/3等）"
echo "  - mipsel_24kc: MIPS 小端（常见路由器）"
echo ""
echo "Install on OpenWrt:"
echo "  1. 安装依赖:"
echo "     opkg update"
echo "     opkg install luci-base etherwake netcat"
echo ""
echo "  2. 拷贝 IPK 到 OpenWrt:"
echo "     scp release/${PACKAGE_NAME}_*_<arch>.ipk root@<openwrt-ip>:/tmp/"
echo ""
echo "  3. 安装 IPK:"
echo "     opkg install /tmp/${PACKAGE_NAME}_*_<arch>.ipk"
echo ""
echo "  4. 访问界面:"
echo "     Services -> Wake on LAN Plus"
echo ""
echo "  5. 卸载 IPK:"
echo "     opkg remove luci-app-wolp"
echo "=========================================="
