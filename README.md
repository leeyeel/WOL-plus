# Wake On LAN Plus

> 通过 WOL Magic Packet 实现远程唤醒和关机

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能特性

- **远程唤醒**: 发送 WOL Magic Packet 唤醒局域网内设备
- **远程关机**: 接收带有 6 字节附加数据的 WOL Magic Packet 实现关机
- **Web UI**: 客户端提供美观的 Web 配置界面，支持认证
- **倒计时关机**: 支持配置关机倒计时时长，可取消正在进行的关机任务
- **多平台支持**:
  - OpenWrt 路由器端（amd64、arm64）
  - Windows、Linux 桌面端

## 界面预览

### OpenWrt 端 (LuCI)

![Wake On LAN+](openwrt/wolp.png)

### 客户端 Web UI

![WOLP client](client/wolp-client.jpg)

## 快速开始

### OpenWrt 端安装

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

### 客户端安装

#### Windows

下载 `installer_windows_inno_x64.exe` 安装包：
- [Releases 页面](https://github.com/leeyeel/WOL-plus/releases) - 查找最新版本
- 下载后直接运行安装程序即可

> **注意**: Windows 安装包需在 Windows 环境下手动构建后上传到 Releases

#### Linux

从源码编译安装：

```bash
git clone https://github.com/leeyeel/WOL-plus.git
cd WOL-plus
make
sudo make install
```

### 使用说明

**默认端口**: `2025`

**默认凭据**: `admin` / `admin123`（请登录后立即修改）

#### OpenWrt 端配置

1. 在 LuCI 界面配置目标设备的 MAC 地址
2. 附加数据填写 **6 字节**十六进制（如 `AA:BB:CC:DD:EE:FF`）
3. 点击"发送"按钮

#### 客户端 Web UI

1. 访问 `http://<客户端-ip>:2025`
2. 使用默认凭据登录
3. 配置附加数据（需与 OpenWrt 端配置一致）
4. 配置关机倒计时时长
5. 可取消正在进行的关机任务

## 工作原理

```
┌─────────────────┐     WOL Magic Packet            ┌─────────────────┐
│   OpenWrt 端    │ ─────────────────────────▶      │    客户端       │
│  (LuCI Web UI)  │   附加数据: XX:XX:XX:XX:XX:XX   │   (Go 服务)     │
│                 │   (固定 6 字节)                 │                 │
└─────────────────┘                                 └─────────────────┘
```

当客户端接收到带有匹配附加数据的 WOL Magic Packet 时，触发倒计时关机。

## 开发指南

### 构建 IPK 包

```bash
cd openwrt
chmod +x build-ipk.sh
./build-ipk.sh
```

生成的 IPK 包位于 `release/` 目录。

当前构建架构：`amd64`、`arm64`

### 构建客户端

#### Linux

```bash
cd WOL-plus
make
```

#### Windows

在 Windows 环境下执行：

```powershell
# 编译
.\build.ps1

# 打包（需要安装 Inno Setup）
iscc .\install\windows_x86_64.iss
```

生成的安装包位于 `install\Output\installer_windows_inno_x64.exe`

### GitHub Actions 自动构建

项目配置了 CI/CD 自动构建：

- **IPK 包**: 推送到 main 分支或创建 tag 时自动构建（amd64、arm64）
- **客户端二进制**: 创建 tag 时自动构建多平台版本

支持的平台：
- OpenWrt (amd64、arm64)
- Linux (amd64、arm64)
- Windows (amd64)

## 许可证

[MIT License](LICENSE)

## 致谢

- [luci-app-wol](https://github.com/openwrt/luci) - OpenWrt 官方 WOL 应用，本项目基于其修改
- [WinSW](https://github.com/winsw/winsw) - Windows 服务包装器
