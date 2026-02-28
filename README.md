# Wake On LAN Plus 既可唤醒，又可关机

openwrt 端展示:

![Wake On LAN+](openwrt/wolp.png)

客户端展示:

![WOLP client](client/wolp-client.jpg)

## 功能说明

- **远程唤醒**: 发送 WOL Magic Packet 唤醒局域网内设备
- **远程关机**: 通过附加数据区分唤醒/关机指令，支持倒计时关机
- **Web UI**: 客户端提供美观的 Web 配置界面，支持认证
- **状态区分**: 使用附加数据第 6 字节区分操作类型（01=唤醒，02=关机）

## 安装及使用方法

### OpenWrt 端安装

**如果你的 OpenWrt 中已经安装了 wol，请先卸载** (`opkg remove luci-app-wol`)

#### 方法一：使用 ipk 包安装（推荐）

从 [releases](https://github.com/leeyeel/WOL-plus/releases) 下载 `luci-app-wolp_*.ipk`

```bash
# 1. 上传到 OpenWrt
scp luci-app-wolp_*.ipk root@<openwrt-ip>:/tmp/

# 2. 登录 OpenWrt 安装
ssh root@<openwrt-ip>
opkg install /tmp/luci-app-wolp_*.ipk

# 3. 确保 etherwake 已安装
opkg install etherwake
```

安装完成后，访问 LuCI 界面 → 服务 → Wake on LAN+

#### 方法二：手动安装

```bash
# 1. 拷贝 wol.js 到 LuCI 资源目录
scp openwrt/wol.js root@<openwrt-ip>:/www/luci-static/resources/view/

# 2. 拷贝中文翻译
scp openwrt/wol.zh-cn.lmo root@<openwrt-ip>:/usr/lib/lua/luci/i18n/
```

### 客户端安装

#### Windows
访问 [releases](https://github.com/leeyeel/WOL-plus/releases)，下载 `installer_windows_inno_x64.exe` 直接安装。

#### Linux/macOS
```bash
cd WOL-plus
make
sudo make install
```

服务默认监听端口 **2025**，首次运行会自动生成配置文件。

**默认凭据**: `admin` / `admin123`（请登录后立即修改）

### 使用说明

1. **OpenWrt 端**:
   - 在 LuCI 界面配置目标设备的 MAC 地址
   - 附加数据填写 5 字节十六进制（如 `AA:BB:CC:DD:EE`）
   - 点击"唤醒设备"或"关机设备"按钮

2. **客户端 Web UI**:
   - 访问 `http://<客户端-ip>:2025`
   - 配置关机倒计时时长
   - 可取消正在进行的关机任务

## 开发指南

### 构建 ipk 包

```bash
cd openwrt
./build-ipk.sh
```

生成的 ipk 包位于 `release/` 目录。

### Windows 下编译打包

进到 WOL-plus 目录中，分别执行如下命令：

编译
```bash
./build.ps1
```

打包
```bash
iscc .\install\windows_x86_64.iss
```

执行成功后会生成 `install\Output\installer_windows_inno_x64.exe` 文件，之后安装即可。

### luci-app-wol 源代码

基于 [luci-app-wol](https://github.com/openwrt/luci/tree/master/applications/luci-app-wol) 修改。

主要变更:
- `wol.js`: 添加独立的唤醒/关机按钮，使用附加数据区分操作
- `wol.po`: 更新中文翻译

### wol.po 转 wol.lmo

如需自行编译翻译文件：

```bash
git clone https://github.com/openwrt/luci.git
cd luci/modules/luci-base
make po2lmo
./po2lmo openwrt/wol.po openwrt/wol.zh-cn.lmo
```

## 技术架构

```
┌─────────────────┐         WOL Magic Packet         ┌─────────────────┐
│   OpenWrt 端    │ ───────────────────────────────▶ │    客户端       │
│  (LuCI Web UI)  │    附加数据: XX:XX:XX:XX:XX:OP   │   (Go 服务)     │
│                 │    OP=01: 唤醒  OP=02: 关机      │                 │
└─────────────────┘                                  └─────────────────┘
```

## 许可证

[MIT License](LICENSE)
