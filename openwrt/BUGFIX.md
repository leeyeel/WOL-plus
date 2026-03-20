# 问题修复说明 v1.0.0

## 修复的问题

### 问题 1：按钮文本不准确

**问题描述**：
- 界面有"唤醒"和"关机"两种操作
- 但按钮文本固定显示"唤醒主机"或"关闭主机"
- 用户需要根据选择的操作来理解按钮含义

**修复方案**：
- 将按钮文本统一改为"Execute"（执行）
- 中文翻译：执行
- 按钮始终显示相同文本，更加简洁明了

**修改文件**：
- `wolp.js`: 修改 `addFooter()` 函数
- `wolp.pot`: 更新英文模板
- `wolp.po`: 更新中文翻译

### 问题 2：权限错误

**问题描述**：
```
唤醒主机失败: PermissionError: 没有权限
关闭主机失败: PermissionError: 没有权限
```

**原因分析**：
- 使用了 `fs.exec()` 直接执行命令
- `fs.exec()` 没有足够的权限执行 `etherwake` 和 `nc`
- LuCI 的安全机制阻止了直接执行系统命令

**修复方案**：
- 使用 RPC 接口 `luci.wolp.exec()` 替代 `fs.exec()`
- RPC 接口通过 ACL 配置有正确的权限
- 符合 LuCI 的安全规范

**修改文件**：
- `wolp.js`:
  - 移除 `'require fs'`
  - 添加 `callWolpStat` RPC 声明
  - 添加 `callWolpExec` RPC 声明
  - 修改 `load()` 函数使用 RPC
  - 修改 `handleWakeup()` 函数使用 RPC

## 技术细节

### RPC 接口

**luci.wolp.stat()**
- 功能：检测 etherwake 和 netcat 是否安装
- 返回：`{ etherwake: true/false, netcat: true/false }`

**luci.wolp.exec(name, args)**
- 功能：执行指定命令
- 参数：
  - `name`: 命令路径（如 `/usr/bin/etherwake`）
  - `args`: 参数数组（如 `['-D', '-i', 'br-lan', 'AA:BB:CC:DD:EE:FF']`）
- 返回：`{ stdout: "...", stderr: "..." }`
- 安全：只允许执行 `etherwake` 和 `nc` 命令

### 权限配置

**ACL 文件**：`root/usr/share/rpcd/acl.d/luci-app-wolp.json`

```json
{
  "luci-app-wolp": {
    "description": "Grant access to wake-on-lan executables",
    "read": {
      "ubus": {
        "luci.wolp": ["stat", "exec"]
      }
    }
  }
}
```

### 代码对比

**之前（使用 fs.exec）**：
```javascript
'require fs';

load: function() {
    return Promise.all([
        L.resolveDefault(fs.stat('/usr/bin/etherwake')),
        L.resolveDefault(fs.stat('/usr/bin/nc')),
        ...
    ]);
}

// 执行命令
return fs.exec(bin, args).then(function(res) {
    // 处理结果
});
```

**现在（使用 RPC）**：
```javascript
callWolpStat: rpc.declare({
    object: 'luci.wolp',
    method: 'stat',
    expect: {}
}),

callWolpExec: rpc.declare({
    object: 'luci.wolp',
    method: 'exec',
    params: ['name', 'args'],
    expect: {}
}),

load: function() {
    return Promise.all([
        L.resolveDefault(this.callWolpStat()),
        ...
    ]);
}

// 执行命令
return this.callWolpExec('/usr/bin/etherwake', args).then(function(res) {
    // 处理结果
});
```

## 翻译更新

### 英文（wolp.pot）

```
msgid "Execute"
msgstr ""

msgid "Command executed successfully"
msgstr ""
```

### 简体中文（zh_Hans/wolp.po）

```
msgid "Execute"
msgstr "执行"

msgid "Command executed successfully"
msgstr "命令执行成功"
```

## 测试验证

### 测试步骤

1. **安装包**
```bash
opkg install /tmp/luci-app-wolp_1.0.0_x86_64.ipk
opkg install /tmp/luci-i18n-wolp-zh-cn_1.0.0_x86_64.ipk
```

2. **访问界面**
- 浏览器：Services → Wake on LAN Plus
- 或：服务 → 网络唤醒+

3. **测试唤醒**
- Action: Wake up
- Network interface: 选择接口
- Host: 输入 MAC 地址
- 点击"Execute"（执行）按钮
- 应显示：正在唤醒主机 → 命令执行成功

4. **测试关机**
- Action: Shutdown
- Network interface: 选择接口
- Host: 输入 MAC 地址
- Additional Data: 输入 6 字节数据
- UDP Port: 9
- 点击"Execute"（执行）按钮
- 应显示：正在关闭主机 → 关机命令发送成功

### 预期结果

✅ **按钮文本**：
- 英文界面：显示"Execute"
- 中文界面：显示"执行"

✅ **权限问题**：
- 不再出现"PermissionError"
- 命令正常执行
- 显示执行结果

✅ **功能正常**：
- 唤醒功能正常工作
- 关机功能正常工作
- 错误提示清晰

## 包信息

### 主包（luci-app-wolp）
- **版本**: 1.0.0
- **大小**: 4.4KB（之前 4.6KB）
- **语言**: 英文
- **修改**: 使用 RPC 接口

### 翻译包（luci-i18n-wolp-zh-cn）
- **版本**: 1.0.0
- **大小**: 1.9KB
- **语言**: 简体中文
- **修改**: 更新按钮翻译

## 升级说明

### 从旧版本升级

```bash
# 1. 卸载旧版本
opkg remove luci-app-wolp luci-i18n-wolp-zh-cn

# 2. 清理旧文件
rm -f /usr/lib/lua/luci/i18n/wol*.lmo
rm -rf /tmp/luci-*

# 3. 安装新版本
opkg install /tmp/luci-app-wolp_1.0.0_x86_64.ipk
opkg install /tmp/luci-i18n-wolp-zh-cn_1.0.0_x86_64.ipk

# 4. 重启服务
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart

# 5. 清除浏览器缓存
# 按 Ctrl+F5
```

## 故障排查

### 问题：仍然提示权限错误

**检查 RPC 接口**：
```bash
# 检查 RPC 文件
ls -la /usr/share/rpcd/ucode/luci.wolp

# 检查 ACL 文件
ls -la /usr/share/rpcd/acl.d/luci-app-wolp.json

# 重启 rpcd
/etc/init.d/rpcd restart
```

### 问题：按钮仍显示旧文本

**清除缓存**：
```bash
# 清除 LuCI 缓存
rm -rf /tmp/luci-*

# 重启 uhttpd
/etc/init.d/uhttpd restart

# 清除浏览器缓存
# 按 Ctrl+Shift+Delete 或 Ctrl+F5
```

### 问题：翻译不生效

**检查翻译文件**：
```bash
# 检查翻译包是否安装
opkg list-installed | grep luci-i18n-wolp

# 检查翻译文件
ls -la /usr/lib/lua/luci/i18n/wolp.zh-cn.lmo

# 如果缺失，重新安装翻译包
opkg install --force-reinstall /tmp/luci-i18n-wolp-zh-cn_1.0.0_x86_64.ipk
```

## 总结

✅ **修复完成**：
1. 按钮文本统一为"Execute"（执行）
2. 权限问题已解决，使用 RPC 接口
3. 功能正常，唤醒和关机都能正常工作

✅ **包大小优化**：
- 主包：4.4KB（减少 0.2KB）
- 翻译包：1.9KB（不变）

✅ **符合规范**：
- 使用 LuCI 标准 RPC 接口
- 遵循安全最佳实践
- ACL 权限配置正确

---

**版本**: 1.0.0
**日期**: 2025-03-15
**维护者**: leeyeel <mumuli52@gmail.com>
