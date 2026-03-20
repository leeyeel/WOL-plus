# Wake On LAN Plus

> 通过 WOL Magic Packet 实现远程唤醒和关机。
> 通常 Wake On LAN用于网络唤醒设备，WOL-Plus则增加了关机功能。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能特性

- **远程唤醒**: 发送 WOL Magic Packet 唤醒局域网内设备
- **远程关机**: 接收带有 6 字节附加数据的 WOL Magic Packet 实现关机
- **Web UI**: 服务端提供美观的 Web 配置界面，支持认证
- **倒计时关机**: 支持配置关机倒计时时长，可取消正在进行的关机任务
- **多平台支持**:
  - OpenWrt 路由器端（发送端，x86_64、aarch64）
  - Windows 桌面端（接收端 + WebUI，amd64、arm64）
  - Debian/Ubuntu Linux 端（接收端 + WebUI，amd64、arm64）

## 界面预览

### OpenWrt 端 (LuCI - 发送端)

![Wake On LAN+](openwrt/wolp.png)

### Windows 端 (WebUI - 接收端)

![WOLP Server](client/wolp-client.jpg)

## 快速开始

### OpenWrt 端安装（发送端）

**重要**: 如果您的 OpenWrt 中已经安装了官方的 `luci-app-wol`，请先卸载：

```bash
opkg remove luci-app-wol
```

#### 方法一：使用 IPK 包安装（推荐）

从 [Releases](https://github.com/leeyeel/WOL-plus/releases) 下载对应架构的 IPK 包：

```bash
# x86_64 架构
wget https://github.com/leeyeel/WOL-plus/releases/download/v*/luci-app-wolp_*_x86_64.ipk

# aarch64 架构
wget https://github.com/leeyeel/WOL-plus/releases/download/v*/luci-app-wolp_*_aarch64.ipk

# 上传到 OpenWrt
scp luci-app-wolp_*.ipk root@<openwrt-ip>:/tmp/

# 登录 OpenWrt 安装
ssh root@<openwrt-ip>

# 先安装依赖
opkg update
opkg install etherwake

# 安装 IPK 包
opkg install /tmp/luci-app-wolp_*.ipk
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

从 [Releases](https://github.com/leeyeel/WOL-plus/releases) 下载安装包（如 `installer_windows_amd64_v0.0.5.exe`）：

1. 下载后直接运行安装程序
2. 安装完成后服务会自动启动
3. 访问 `http://<本机-ip>:2025` 进行配置

### Debian/Ubuntu 安装（接收端 + WebUI）

从 [Releases](https://github.com/leeyeel/WOL-plus/releases) 下载对应架构的 `.deb` 包（如 `wolp-client_0.0.5_amd64.deb`）：

```bash
sudo dpkg -i wolp-client_0.0.5_amd64.deb
sudo systemctl status wolp.service
```

安装后：

1. 配置文件位于 `/usr/local/etc/wolp/wolp.json`
2. Web UI 位于 `/usr/share/wolp/webui`
3. 服务监听 `http://<linux-ip>:2025`

### RPM 系发行版安装（接收端 + WebUI）

从 [Releases](https://github.com/leeyeel/WOL-plus/releases) 下载对应架构的 `.rpm` 包（如 `wolp-client-0.0.5-1.x86_64.rpm`）：

```bash
sudo rpm -ivh wolp-client-0.0.5-1.x86_64.rpm
sudo systemctl status wolp.service
```

安装后：

1. 配置文件位于 `/usr/local/etc/wolp/wolp.json`
2. Web UI 位于 `/usr/share/wolp/webui`
3. 服务监听 `http://<linux-ip>:2025`

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
4. 如有需要，修改关机 UDP 端口（默认 `9`）
5. 配置关机倒计时时长
6. 可取消正在进行的关机任务

## 工作原理

```
┌─────────────────┐     WOL Magic Packet            ┌─────────────────┐
│   OpenWrt 端    │ ─────────────────────────▶      │   Windows 端    │
│  (LuCI Web UI)  │   附加数据: XX:XX:XX:XX:XX:XX   │   (Go 服务)     │
│   发送端         │   (固定 6 字节)                 │   接收端 + WebUI │
└─────────────────┘                                 └─────────────────┘
```

当接收端接收到带有匹配附加数据的 UDP Magic Packet 时，触发倒计时关机。

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
- `luci-app-wolp_1.0.0_x86_64.ipk`
- `luci-app-wolp_1.0.0_aarch64.ipk`
- 或 `luci-app-wolp_0.0.5_x86_64.ipk`（如果指定了版本）

**注意**:
- IPK 包使用 **tar.gz 格式**（OpenWrt opkg 兼容格式）
- 架构名称使用 OpenWrt 标准命名：`x86_64`（而非 amd64）、`aarch64`（而非 arm64）
- 与官方 `luci-app-wol` 包冲突，安装前需要先卸载

### 构建 Windows 安装包（接收端）

在 Windows 环境下执行：

```powershell
# 编译 amd64
.\scripts\build.ps1 -Arch amd64 -Version 0.0.5

# 打包（需要安装 Inno Setup）
# amd64
iscc /DVERSION=0.0.5 /DAPP_ARCH=amd64 .\scripts\windows_x86_64.iss

```

生成的安装包位于 `scripts\Output\` 目录（文件名包含版本号）：
- `installer_windows_amd64_v0.0.5.exe`

### 构建 Debian 包（接收端）

在 Linux 环境下执行：

```bash
bash scripts/build-deb.sh amd64 0.0.5
bash scripts/build-deb.sh arm64 0.0.5
```

生成的 Debian 包位于 `release/client/` 目录：
- `wolp-client_0.0.5_amd64.deb`
- `wolp-client_0.0.5_arm64.deb`

### 构建 RPM 包（接收端）

在 Linux 环境下执行：

```bash
bash scripts/build-rpm.sh amd64 0.0.5
bash scripts/build-rpm.sh arm64 0.0.5
```

生成的 RPM 包位于 `release/client/` 目录：
- `wolp-client-0.0.5-1.x86_64.rpm`
- `wolp-client-0.0.5-1.aarch64.rpm`

### GitHub Actions 自动构建

项目配置了 CI/CD 自动构建，构建产物文件名包含 tag 版本号：

- **IPK 包**: 推送到 main 分支或创建 tag 时自动构建
  - Tag `v0.0.5` → `luci-app-wolp_0.0.5_x86_64.ipk`、`luci-app-wolp_0.0.5_aarch64.ipk`
- **Windows 安装包**: 推送到 main、PR 或创建 tag 时自动构建
  - Tag `v0.0.5` → `installer_windows_amd64_v0.0.5.exe`
- **Debian 包**: 推送到 main、PR 或创建 tag 时自动构建
  - Tag `v0.0.5` → `wolp-client_0.0.5_amd64.deb`、`wolp-client_0.0.5_arm64.deb`
- **RPM 包**: 推送到 main、PR 或创建 tag 时自动构建
  - Tag `v0.0.5` → `wolp-client-0.0.5-1.x86_64.rpm`、`wolp-client-0.0.5-1.aarch64.rpm`

## 许可证

[MIT License](LICENSE)

## 致谢

- [luci-app-wol](https://github.com/openwrt/luci) - OpenWrt 官方 WOL 应用，本项目基于其修改
- [WinSW](https://github.com/winsw/winsw) - Windows 服务包装器
