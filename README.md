# WOL+ 即可以唤醒，又可以关机

![Wake On LAN+](openwrt/wolp.png)

### 使用警告

本着能偷懒则偷懒的原则，
直接利用etherwake来实现。优点就是可以偷懒，省去很多工作。但是缺点也很明显:

1. 关机与唤醒都使用了WOL协议，只不过关机使用了WOL中的自定义数据

这个自定义数据通常没人使用，但是如果你的设备已经利用了这个自定义数据，
可能会造成冲突（虽然通常不会，毕竟6个字节也有16^6这么多)。

2. 还是因为复用了WOL协议，如果重复发送关机命令，可能导致原本已经关机的设备又开机。

第一次发送数据包关机了，然后又发送关机数据包，但如果没有设置附加数据，
实际这个关机数据包也会被当作开机数据包唤醒设备。

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

