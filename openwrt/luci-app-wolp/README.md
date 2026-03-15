# luci-app-wolp - Wake on LAN Plus

OpenWrt LuCI 应用，用于网络唤醒和远程关机功能。

## 核心特性

- ✅ **唤醒功能**：使用 etherwake 发送原始套接字唤醒包
- ✅ **关机功能**：使用 netcat 发送 UDP 数据包关机命令
- ✅ **多目标管理**：支持配置多个目标主机
- ✅ **自定义端口**：可配置 UDP 关机端口（默认 9）
- ✅ **附加数据**：支持 6 字节自定义数据用于关机验证
- ✅ **中文支持**：简体中文和繁体中文翻译

## 目录结构

```
luci-app-wolp/
├── Makefile                          # OpenWrt 包构建文件
├── htdocs/
│   └── luci-static/
│       └── resources/
│           └── view/
│               └── wolp.js           # 主界面 JS 文件
├── po/                               # 翻译文件
│   ├── templates/wol.pot             # 翻译模板
│   ├── zh_Hans/wol.po                # 简体中文
│   └── zh_Hant/wol.po                # 繁体中文
└── root/                             # 安装到系统的文件
    ├── etc/config/
    │   └── luci-wolp                 # UCI 配置文件
    └── usr/share/
        ├── luci/menu.d/
        │   └── luci-app-wolp.json    # LuCI 菜单配置
        └── rpcd/
            ├── acl.d/
            │   └── luci-app-wolp.json    # 权限控制
            └── ucode/
                └── luci.wolp             # RPC 后端脚本
```

## 依赖关系

- **luci-base**: LuCI 基础框架
- **etherwake**: 用于发送唤醒包（原始套接字）
- **netcat**: 用于发送关机命令（UDP 数据包）

## 工作原理

### 唤醒流程
1. 用户点击 "Wake" 按钮
2. 使用 etherwake 发送标准 WOL 魔法包（原始套接字）
3. 目标主机网卡接收到魔法包后启动

### 关机流程
1. 用户点击 "Shutdown" 按钮
2. 构造 102 字节数据包：
   - 6 字节 0xFF（同步头）
   - 16 次重复的 MAC 地址（96 字节）
   - 6 字节附加数据（用于验证）
3. 使用 netcat 通过 UDP 发送到指定端口（默认 9）
4. 目标主机监听该端口，验证附加数据后执行关机

**注意**：关机功能需要目标主机运行监听程序来接收和处理关机命令。

## 构建说明

```bash
# 在 OpenWrt SDK 中构建
cd openwrt
./scripts/feeds update -a
./scripts/feeds install -a
make package/luci-app-wolp/compile V=s
```

或使用提供的打包脚本：

```bash
cd openwrt
./build-ipk.sh
```

生成的 IPK 包位于 `release/luci-app-wolp_1.0.0_all.ipk`

## 安装

### 1. 安装依赖

```bash
opkg update
opkg install luci-base etherwake netcat
```

### 2. 安装 IPK 包

```bash
# 上传到路由器
scp release/luci-app-wolp_1.0.0_all.ipk root@<路由器IP>:/tmp/

# 在路由器上安装
opkg install /tmp/luci-app-wolp_1.0.0_all.ipk
```

### 3. 访问界面

浏览器打开 LuCI: **Services → Wake on LAN Plus**

## 使用说明

### 添加目标主机

1. 点击 "Add" 按钮
2. 填写配置：
   - **Name**: 主机名称（必填）
   - **MAC Address**: MAC 地址（必填，格式：AA:BB:CC:DD:EE:FF）
   - **Interface**: 网络接口（可选）
   - **Broadcast**: 广播标志（可选）
   - **Password**: SecureOn 密码（可选，格式：MAC 或 IPv4）
   - **Additional Data**: 附加数据（关机必需，6 字节，格式：XX:XX:XX:XX:XX:XX）
3. 点击 "Save & Apply"

### 配置 UDP 端口

在 "Default Settings" 区域设置关机命令的 UDP 端口（默认 9）

### 唤醒主机

点击目标主机行的 "Wake" 按钮，查看 Output 区域的执行结果

### 关机主机

1. 确保已配置 "Additional Data"
2. 点击目标主机行的 "Shutdown" 按钮
3. 查看 Output 区域的执行结果

**重要**：关机功能需要目标主机运行相应的监听程序。

## 卸载

```bash
opkg remove luci-app-wolp
```

## 技术细节

### WOL 魔法包格式（唤醒）

```
标准 WOL 包（102 字节）：
- 6 字节同步流：FF FF FF FF FF FF
- 16 次重复的目标 MAC 地址（96 字节）
```

### 关机数据包格式

```
扩展 WOL 包（102 字节）：
- 6 字节同步流：FF FF FF FF FF FF
- 16 次重复的目标 MAC 地址（96 字节）
- 6 字节附加数据（用于验证身份）
```

### RPC 接口

- **luci.wolp.stat**: 检测 etherwake 和 netcat 是否安装
- **luci.wolp.exec**: 执行唤醒或关机命令

## 故障排查

### 问题 1: 菜单中找不到应用

```bash
rm -rf /tmp/luci-*
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
```

### 问题 2: 唤醒功能不工作

```bash
# 检查 etherwake 是否安装
which etherwake

# 手动测试
etherwake -D AA:BB:CC:DD:EE:FF
```

### 问题 3: 关机功能不工作

```bash
# 检查 netcat 是否安装
which nc

# 确保目标主机运行监听程序
# 确保已配置 Additional Data
```

## 开发说明

### 文件命名规范

- 包名：`luci-app-wolp`
- 配置文件：`luci-wolp`
- RPC 对象：`luci.wolp`
- 菜单路径：`admin/services/wol-plus`

### 添加新语言

1. 在 `po/` 目录创建语言目录（如 `en/`）
2. 复制 `templates/wol.pot` 到该目录并重命名为 `wol.po`
3. 翻译字符串
4. 更新 `build-ipk.sh` 以编译新语言

## 许可证

Apache-2.0

## 维护者

leeyeel <mumuli52@gmail.com>

## 版本历史

### v1.0.0 (2025-03-15)
- 初始版本
- 支持唤醒和关机功能
- 多目标管理
- 中文翻译支持
