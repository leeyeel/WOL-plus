# OpenWrt LuCI App - WOL Plus

OpenWrt 路由器端的 Wake-on-LAN Plus 应用，支持远程唤醒和关机功能。

## 功能特性

- **远程唤醒**：使用 `etherwake` 发送原始套接字 WOL Magic Packet
- **远程关机**：使用 `netcat` 发送 UDP 数据包（避免误唤醒已关机设备）
- **统一数据格式**：唤醒和关机使用相同的 WOL Magic Packet 格式（102字节）
- **可配置端口**：支持自定义 UDP 端口（默认 9）

## 依赖项

- `etherwake` - 用于发送 WOL 唤醒包
- `netcat` - 用于发送 UDP 关机命令

## 安装

### 方法一：使用 IPK 包（推荐）

```bash
# 1. 安装依赖
opkg update
opkg install etherwake netcat

# 2. 下载并安装 IPK 包
opkg install luci-app-wolp_*.ipk
```

### 方法二：手动安装

```bash
# 1. 拷贝文件
scp luci-app-wolp/wol.js root@<openwrt-ip>:/www/luci-static/resources/view/
scp luci-app-wolp/wol.zh-cn.lmo root@<openwrt-ip>:/usr/lib/lua/luci/i18n/

# 2. 重启 LuCI
/etc/init.d/uhttpd reload
```

## 使用说明

1. 访问 LuCI 界面 → 服务 → Wake on LAN+
2. 配置参数：
   - **网络接口**：选择发送数据包的接口
   - **目标主机**：选择或输入 MAC 地址
   - **附加数据**：6字节自定义数据（XX:XX:XX:XX:XX:XX），关机操作必需
   - **UDP 端口**：关机命令的目标端口（默认 9）
   - **广播地址**：是否发送到广播地址
3. 点击按钮：
   - **唤醒主机**：发送 WOL 唤醒包
   - **关闭主机**：发送 UDP 关机命令

## 工作原理

### 唤醒操作

使用 `etherwake` 发送标准 WOL Magic Packet：

```
格式：6字节0xFF + 16次重复MAC地址 + 6字节附加数据（可选）
工具：etherwake -D -i <interface> [-p <extra_data>] <mac>
协议：原始套接字（Layer 2）
```

### 关机操作

使用 `netcat` 发送 UDP 数据包，包含完整的 WOL Magic Packet 格式：

```
格式：6字节0xFF + 16次重复MAC地址 + 6字节附加数据（必需）
工具：printf "<binary_data>" | nc -u -w1 <ip> <port>
协议：UDP（Layer 4）
端口：默认 9（可配置）
```

**为什么关机使用 UDP？**

- 避免误唤醒：已关机的设备不会响应 UDP 包，但会响应 Layer 2 的 WOL 包
- 更灵活：可以指定端口，支持防火墙规则
- 更可靠：UDP 包可以通过路由器转发

## 数据包格式

两种操作使用相同的 102 字节数据包格式：

```
Offset  | Length | Description
--------|--------|----------------------------------
0-5     | 6      | 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF
6-101   | 96     | MAC 地址重复 16 次（6 * 16 = 96）
102-107 | 6      | 附加数据（自定义识别码）
```

## 构建

```bash
cd openwrt
VERSION=0.2.0 ./build-ipk.sh
```

生成的 IPK 包位于 `release/` 目录：
- `luci-app-wolp_0.2.0_x86_64.ipk`
- `luci-app-wolp_0.2.0_aarch64.ipk`

## 目录结构

```
openwrt/
├── build-ipk.sh              # IPK 打包脚本
├── luci-app-wolp/            # 应用文件
│   ├── wol.js                # LuCI 界面（JavaScript）
│   ├── wol.po                # 翻译源文件
│   ├── wol.zh-cn.lmo         # 中文翻译（编译后）
│   └── wolp.png              # 应用图标
└── README.md                 # 本文档
```

## 配置示例

### 唤醒设备

```
MAC 地址：AA:BB:CC:DD:EE:FF
附加数据：（留空或填写）
操作：点击"唤醒主机"
```

### 关机设备

```
MAC 地址：AA:BB:CC:DD:EE:FF
附加数据：11:22:33:44:55:66（必需，需与客户端配置一致）
UDP 端口：9（默认）
操作：点击"关闭主机"
```

## 注意事项

1. **附加数据必须一致**：OpenWrt 端和客户端配置的附加数据必须完全相同
2. **关机需要附加数据**：关机操作必须配置附加数据，否则会提示错误
3. **端口配置**：确保客户端监听的端口与 OpenWrt 配置的端口一致
4. **防火墙规则**：如果使用 UDP 关机，确保防火墙允许相应端口的流量

## 许可证

MIT License
