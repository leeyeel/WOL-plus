# luci-app-wolp 分离打包说明

## 包结构

### 主包：luci-app-wolp
- **大小**: 4.6KB
- **语言**: 英文（默认）
- **依赖**: libc, luci-base, etherwake, netcat
- **内容**:
  - 核心功能代码
  - 英文界面
  - 配置文件
  - RPC 接口

### 翻译包：luci-i18n-wolp-zh-cn
- **大小**: 1.9KB
- **语言**: 简体中文
- **依赖**: luci-app-wolp
- **内容**:
  - wolp.zh-cn.lmo（简体中文翻译，26个字符串）

## 生成的包

```
release/
├── luci-app-wolp_1.0.0_x86_64.ipk (4.6KB)
├── luci-app-wolp_1.0.0_aarch64_generic.ipk (4.6KB)
├── luci-i18n-wolp-zh-cn_1.0.0_x86_64.ipk (1.9KB)
└── luci-i18n-wolp-zh-cn_1.0.0_aarch64_generic.ipk (1.9KB)
```

## 安装方式

### 方式 1：仅英文界面

```bash
# 1. 安装依赖
opkg update
opkg install luci-base etherwake netcat

# 2. 安装主包
opkg install /tmp/luci-app-wolp_1.0.0_x86_64.ipk

# 3. 访问界面（英文）
# Services -> Wake on LAN Plus
```

### 方式 2：英文 + 中文

```bash
# 1. 安装依赖
opkg update
opkg install luci-base etherwake netcat

# 2. 安装主包
opkg install /tmp/luci-app-wolp_1.0.0_x86_64.ipk

# 3. 安装中文翻译
opkg install /tmp/luci-i18n-wolp-zh-cn_1.0.0_x86_64.ipk

# 4. 清除浏览器缓存
# 按 Ctrl+F5 强制刷新

# 5. 访问界面（中文）
# 服务 -> 网络唤醒+
```

### 方式 3：先安装中文，后安装主包

```bash
# 顺序无关，翻译包会等待主包安装
opkg install /tmp/luci-i18n-wolp-zh-cn_1.0.0_x86_64.ipk
opkg install /tmp/luci-app-wolp_1.0.0_x86_64.ipk
```

## 卸载

### 卸载主包（会自动卸载翻译包）

```bash
opkg remove luci-app-wolp
```

### 仅卸载翻译包（保留主包）

```bash
opkg remove luci-i18n-wolp-zh-cn
# 界面会恢复为英文
```

### 完全卸载

```bash
opkg remove luci-app-wolp luci-i18n-wolp-zh-cn
```

## 优势

### 1. 包大小优化
- **之前**（包含翻译）：6.0KB
- **现在**（主包）：4.6KB
- **翻译包**：1.9KB
- **总计**：6.5KB（略有增加，但更灵活）

### 2. 灵活性
- 用户可以选择是否安装翻译
- 不需要中文的用户节省 1.9KB 空间
- 未来可以添加更多语言包而不影响主包

### 3. 符合 LuCI 规范
- 遵循 OpenWrt/LuCI 的标准打包方式
- 翻译包命名规范：`luci-i18n-<app>-<lang>`
- 依赖关系清晰

### 4. 易于维护
- 翻译更新不需要重新打包主包
- 可以独立发布翻译包更新
- 便于社区贡献其他语言翻译

## 翻译包详情

### 包含的翻译字符串（26个）

**页面标题**：
- Wake on LAN Plus → 网络唤醒+

**表单字段**：
- Action → 操作
- Wake up → 唤醒
- Shutdown → 关机
- Network interface to use → 使用的网络接口
- Host to wake up or shutdown → 要唤醒或关闭的主机
- Additional Data → 附加数据
- Send to broadcast address → 发送到广播地址
- UDP Port for Shutdown → 关机UDP端口

**按钮**：
- Wake up host → 唤醒主机
- Shutdown host → 关闭主机

**提示信息**：
- Waking host → 正在唤醒主机
- Shutting down host → 正在关闭主机
- Shutdown command sent successfully → 关机命令发送成功
- Dismiss → 关闭

**错误提示**：
- No target host specified! → 未指定目标主机！
- etherwake is not installed! → etherwake未安装！
- netcat is not installed! → netcat未安装！
- Additional data is required for shutdown operation! → 关机操作需要附加数据！
- Waking host failed → 唤醒主机失败
- Shutting down host failed → 关闭主机失败

## 验证安装

### 检查主包

```bash
opkg list-installed | grep luci-app-wolp
# 应显示：luci-app-wolp - 1.0.0
```

### 检查翻译包

```bash
opkg list-installed | grep luci-i18n-wolp
# 应显示：luci-i18n-wolp-zh-cn - 1.0.0
```

### 检查翻译文件

```bash
ls -la /usr/lib/lua/luci/i18n/wolp*
# 应显示：wolp.zh-cn.lmo
```

## 故障排查

### 问题 1：安装翻译包后仍显示英文

**解决方案**：
```bash
# 1. 清除 LuCI 缓存
rm -rf /tmp/luci-*

# 2. 重启 uhttpd
/etc/init.d/uhttpd restart

# 3. 清除浏览器缓存
# 按 Ctrl+F5 强制刷新
```

### 问题 2：翻译包安装失败

**检查依赖**：
```bash
# 确保主包已安装
opkg list-installed | grep luci-app-wolp

# 如果未安装，先安装主包
opkg install /tmp/luci-app-wolp_1.0.0_x86_64.ipk
```

### 问题 3：卸载主包后翻译包残留

**清理**：
```bash
# 手动卸载翻译包
opkg remove luci-i18n-wolp-zh-cn

# 或强制卸载
opkg remove --force-depends luci-i18n-wolp-zh-cn
```

## 未来扩展

### 添加其他语言

可以创建更多翻译包：
- `luci-i18n-wolp-zh-tw`（繁体中文）
- `luci-i18n-wolp-ja`（日语）
- `luci-i18n-wolp-de`（德语）
- `luci-i18n-wolp-fr`（法语）
- 等等...

每个翻译包独立，用户按需安装。

## 技术说明

### 翻译文件格式

- **源文件**：`po/zh_Hans/wolp.po`（人类可读）
- **编译后**：`wolp.zh-cn.lmo`（二进制，LuCI 使用）

### LuCI 翻译加载机制

1. LuCI 根据浏览器语言设置查找翻译文件
2. 文件命名规则：`<module>.zh-cn.lmo`
3. 查找路径：`/usr/lib/lua/luci/i18n/`
4. 如果找不到翻译，显示英文原文

### 包依赖关系

```
luci-app-wolp (主包)
    ↑
    │ depends
    │
luci-i18n-wolp-zh-cn (翻译包)
```

翻译包依赖主包，但主包不依赖翻译包。

## 总结

✅ **优点**：
- 主包更小（4.6KB vs 6.0KB）
- 用户可选择是否安装翻译
- 符合 LuCI 标准规范
- 易于维护和扩展

✅ **推荐**：
- 国际用户：只安装主包
- 中文用户：安装主包 + 翻译包

---

**版本**: 1.0.0
**日期**: 2025-03-15
**维护者**: leeyeel <mumuli52@gmail.com>
