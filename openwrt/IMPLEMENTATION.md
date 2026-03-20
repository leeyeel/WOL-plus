# luci-app-wolp 实现说明

## 版本：1.0.0

## 实现方案

### 唤醒操作
- **工具**：etherwake
- **方法**：LuCI 前端调用 `luci.wolp.exec('/usr/bin/etherwake', args)`
- **参数**：
  - `-D`：调试模式
  - `-i <interface>`：指定网络接口
  - `-b`：发送到广播地址（可选）
  - `<MAC地址>`：目标主机 MAC 地址

### 关机操作
- **工具**：netcat (UDP)
- **方法**：LuCI 前端调用 `luci.wolp.exec('/bin/sh', ['-c', cmd])`
- **数据包格式**：
  - 6 字节：`FF:FF:FF:FF:FF:FF`（魔术包头）
  - 96 字节：目标 MAC 地址重复 16 次
  - 6 字节：附加数据（默认 `FF:FF:FF:FF:FF:FF`）
- **UDP 端口**：默认 9（可配置）
- **目标地址**：目标主机 IPv4 地址（自动从 host hints 获取）

## 权限配置

### ACL 文件：`/usr/share/rpcd/acl.d/luci-app-wolp.json`

```json
{
  "luci-app-wolp": {
    "description": "Grant access to wake-on-lan-plus executables",
    "read": {
      "ubus": {
        "luci.wolp": [ "stat" ],
        "luci-rpc": [ "getHostHints", "getNetworkDevices" ]
      },
      "uci": [ "luci-wolp" ]
    },
    "write": {
      "ubus": {
        "luci.wolp": [ "exec" ]
      },
      "uci": [ "luci-wolp" ]
    }
  }
}
```

### 权限说明
- `luci.wolp.stat`：检测 `etherwake` / `netcat` 是否可用
- `luci.wolp.exec`：由 rpcd 后端统一执行唤醒和关机命令
- `luci-rpc.getHostHints`：获取主机提示信息
- `uci.luci-wolp`：读写 UCI 配置

## 与原实现的区别

### 原实现（WOL+）
- 唤醒和关机都使用 etherwake
- 通过 `-p` 参数的最后一个字节区分操作类型：
  - `XX:XX:XX:XX:XX:01`：唤醒
  - `XX:XX:XX:XX:XX:02`：关机
- 优点：不需要 shell 权限，权限问题少
- 缺点：依赖 etherwake 的特定实现

### 当前实现（WOLP）
- 唤醒使用 etherwake（标准 WOL）
- 关机使用 netcat（UDP 数据包）
- 关机发往目标主机的 IPv4 地址，不依赖 `netcat -b` 广播选项
- 由于 UDP 无确认机制，界面语义应为“请求已发送”，而不是“对方已确认关机”
- 优点：更灵活，符合标准 WOL 协议；前端不再依赖 `fs.exec()` 权限
- 缺点：依赖 rpcd 后端脚本和 ACL 正常安装

## 权限问题排查

### etherwake 权限问题
**状态**：✅ 应该已解决

**原因**：
- 通过 `luci.wolp.exec()` 由 rpcd 后端执行
- 不再依赖 LuCI `file.exec` 权限
- ACL 只需授权 `luci.wolp.exec`

**验证**：
```bash
# 检查 etherwake 是否可执行
ls -la /usr/bin/etherwake

# 检查 ACL 配置
cat /usr/share/rpcd/acl.d/luci-app-wolp.json

# 重启 rpcd 服务
/etc/init.d/rpcd restart
```

### netcat 关机权限问题
**状态**：✅ 已修复

**原因**：
- 前端不再直接调用 `fs.exec('/bin/sh', ...)`
- shell 管道由 rpcd 后端封装执行
- 用户无需额外处理 LuCI 侧执行权限

**当前方案**：
1. 前端统一调用 `luci.wolp.exec`
2. ACL 授权 `luci.wolp.exec`
3. rpcd 后端负责执行 `printf | netcat`

**验证**：
```bash
# 检查 rpcd 后端脚本
ls -la /usr/share/rpcd/ucode/luci.wolp

# 检查 ACL
cat /usr/share/rpcd/acl.d/luci-app-wolp.json

# 检查 rpcd 日志
logread | grep rpcd
```

## 安装说明

### 依赖
```bash
opkg install luci-base etherwake netcat
```

### 安装步骤
```bash
# 1. 安装主包
opkg install /tmp/luci-app-wolp_1.0.0_<arch>.ipk

# 2. 安装中文翻译（可选）
opkg install /tmp/luci-i18n-wolp-zh-cn_1.0.0_<arch>.ipk

# 3. 重启服务
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart

# 4. 清除浏览器缓存
# 按 Ctrl+F5
```

## 故障排查

### 问题：etherwake 提示"没有权限"

**检查**：
```bash
# 1. 检查 ACL 文件
cat /usr/share/rpcd/acl.d/luci-app-wolp.json

# 2. 检查 rpcd 服务
/etc/init.d/rpcd status

# 3. 重启 rpcd
/etc/init.d/rpcd restart

# 4. 查看日志
logread | grep -E "rpcd|luci|wolp"
```

### 问题：netcat 关机提示"没有权限"

**检查**：
1. 确认 `/usr/share/rpcd/ucode/luci.wolp` 已安装且可执行
2. 确认 `/usr/share/rpcd/acl.d/luci-app-wolp.json` 已安装
3. 重启 `rpcd` 和 `uhttpd`
4. 清理 `/tmp/luci-*` 后刷新浏览器缓存

## 文件清单

```
luci-app-wolp/
├── htdocs/luci-static/resources/view/wolp.js  # 主界面
├── root/
│   └── usr/share/
│       ├── luci/menu.d/luci-app-wolp.json     # 菜单配置
│       └── rpcd/acl.d/luci-app-wolp.json      # ACL 权限
├── po/                                         # 翻译文件
│   ├── templates/wolp.pot                      # 英文模板
│   └── zh_Hans/wolp.po                         # 简体中文
└── Makefile                                    # 构建配置
```

## 维护者

leeyeel <mumuli52@gmail.com>

## 许可证

Apache-2.0
