# Wake On LAN Plus 既可以唤醒，又可以关机

![Wake On LAN+](openwrt/wolp.png)

### 使用警告

使用了etherwake来发送数据包，所以有以下问题需要注意：

- 关机与唤醒都使用了WOL数据包

如果第一次发送数据包，设备关机完毕，此时再次发送关机数据包，
这个数据包会被当作唤醒数据包唤醒设备。

[WOL原项目](https://github.com/openwrt/luci/tree/master/applications/luci-app-wol)

### 安装及使用方法

**如果你的openwrt中已经安装了wol，请先卸载**

1. openwrt端安装

```
## 注意替换ip为openwrt的ip

##拷贝 wol.zh-cn.lom文件到openwrt的/usr/lib/lua/luci/i18n/目录
scp -O openwrt/wol.zh-cn.lmo root@[ip]:/usr/lib/lua/luci/i18n/

##拷贝 wol.js文件到openwrt的/www/luci-static/resources/view/目录
scp -O openwrt/wol.js root@[ip]:/www/luci-static/resources/view/
```
2. 客户端安装
    - windows
    - linux/macos

### 开发指南

1. luci-app-wol源代码

如果想自己编译openwrt可直接替换文件即可

[luci-app-wol原项目地址](https://github.com/openwrt/luci/tree/master/applications/luci-app-wol)

替换当前目录下openwrt/wol.js到luci-app-wol/htdocs/luci-static/resources/view/
替换当前目录下openwrt/wol.po到luci-app-wol/po/zh_Hans

2. wol.po文本文件转wol.lmo二进制文件

需要使用po2lmo转换，如果没有，需要自己编译

```
git clone https://github.com/openwrt/luci.git
cd luci/modules/luci-base
make po2lmo
```

便已完成po2lmo后使用`po2lmo wol.po wol.lmo`即可完成转换。

