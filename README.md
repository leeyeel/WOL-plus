# Wake On LAN Plus

> 通过 WOL Magic Packet 实现远程唤醒和关机

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能特性

- **远程唤醒**: 发送 WOL Magic Packet 唤醒局域网内设备
- **远程关机**: 接收带有 6 字节附加数据的 WOL Magic Packet 实现关机
- **Web UI**: 服务端提供美观的 Web 配置界面，支持认证
- **倒计时关机**: 支持配置关机倒计时时长，可取消正在进行的关机任务
- **多平台支持**:
  - OpenWrt 路由器端（发送端，amd64、arm64）
  - Windows 桌面端（接收端 + WebUI）

## 界面预览

### OpenWrt 端 (LuCI - 发送端)

![Wake On LAN+](openwrt/wolp.png)

### Windows 端 (WebUI - 接收端)

![WOLP Server](client/wolp-client.jpg)

## 快速开始

### OpenWrt 端安装（发送端）

**如果你的 OpenWrt 中已经安装了 wol，请先卸载** (`opkg remove luci-app-wol`)

#### 方法一：使用 IPK 包安装（推荐）

从 [Releases](https://github.com/leeyeel/WOL-plus/releases) 下载对应架构的 IPK 包：

```bash
# amd64 架构
wget https://github.com/leeyeel/WOL-plus/releases/download/v*/luci-app-wolp_*_amd64.ipk

# arm64 架构
wget https://github.com/leeyeel/WOL-plus/releases/download/v*/luci-app-wolp_*_arm64.ipk

# 上传到 OpenWrt
scp luci-app-wolp_*.ipk root@<openwrt-ip>:/tmp/

# 登录 OpenWrt 安装
ssh root@<openwrt-ip>
opkg install /tmp/luci-app-wolp_*.ipk

# 确保依赖已安装
opkg install etherwake
```

安装完成后，访问 LuCI 界面 → 服务 → Wake on LAN+

#### 方法二：手动安装

```bash
# 1. 拷贝 LuCI JavaScript 文件
scp openwrt/wol.js root@<openwrt-ip>:/www/luci-static/resources/view/

# 2. 拷贝中文翻译
scp openwrt/wol.zh-cn.lmo root@<openwrt-ip>:/usr/lib/lua/luci/i18n/
```

### Windows 端安装（接收端 + WebUI）

从 [Releases](https://github.com/leeyeel/WOL-plus/releases) 下载安装包（如 `installer_windows_inno_x64_v0.0.5.exe`）：

1. 下载后直接运行安装程序
2. 安装完成后服务会自动启动
3. 访问 `http://<本机-ip>:2025` 进行配置

### 使用说明

**默认端口**: `2025`

**默认凭据**: `admin` / `admin123`（请登录后立即修改）

#### OpenWrt 端配置（发送端）

1. 在 LuCI 界面配置目标设备的 MAC 地址
2. 附加数据填写 **6 字节**十六进制（如 `AA:BB:CC:DD:EE:FF`）
3. 点击"发送"按钮

#### Windows 端 WebUI（接收端）

1. 访问 `http://<windows-ip>:2025`
2. 使用默认凭据登录
3. 配置附加数据（需与 OpenWrt 端配置一致）
4. 配置关机倒计时时长
5. 可取消正在进行的关机任务

## 工作原理

```
┌─────────────────┐     WOL Magic Packet            ┌─────────────────┐
│   OpenWrt 端    │ ─────────────────────────▶      │   Windows 端    │
│  (LuCI Web UI)  │   附加数据: XX:XX:XX:XX:XX:XX   │   (Go 服务)     │
│   发送端         │   (固定 6 字节)                 │   接收端 + WebUI │
└─────────────────┘                                 └─────────────────┘
```

当 Windows 端接收到带有匹配附加数据的 WOL Magic Packet 时，触发倒计时关机。

## 开发指南

### 构建 IPK 包（OpenWrt 发送端）

```bash
cd openwrt
chmod +x build-ipk.sh
# 默认版本 1.0.0
./build-ipk.sh
# 指定版本号
VERSION=0.0.5 ./build-ipk.sh
```

生成的 IPK 包位于 `release/` 目录（文件名包含版本号）：
- `luci-app-wolp_1.0.0_amd64.ipk`
- `luci-app-wolp_1.0.0_arm64.ipk`
- 或 `luci-app-wolp_0.0.5_amd64.ipk`（如果指定了版本）

### 构建 Windows 安装包（接收端）

在 Windows 环境下执行：

```powershell
# 编译
.\build.ps1

# 打包（需要安装 Inno Setup）
# 默认版本 1.0.0
iscc .\install\windows_x86_64.iss
# 指定版本号
iscc /DVERSION=0.0.5 .\install\windows_x86_64.iss
```

生成的安装包位于 `install\Output\` 目录（文件名包含版本号）：
- `installer_windows_inno_x64_v1.0.0.exe`
- 或 `installer_windows_inno_x64_v0.0.5.exe`（如果指定了版本）

### GitHub Actions 自动构建

项目配置了 CI/CD 自动构建，构建产物文件名包含 tag 版本号：

- **IPK 包**: 推送到 main 分支或创建 tag 时自动构建
  - Tag `v0.0.5` → `luci-app-wolp_0.0.5_amd64.ipk`、`luci-app-wolp_0.0.5_arm64.ipk`
- **Windows 安装包**: 创建 tag 时自动构建
  - Tag `v0.0.5` → `installer_windows_inno_x64_v0.0.5.exe`

## 许可证

[MIT License](LICENSE)

## 致谢

- [luci-app-wol](https://github.com/openwrt/luci) - OpenWrt 官方 WOL 应用，本项目基于其修改
- [WinSW](https://github.com/winsw/winsw) - Windows 服务包装器
