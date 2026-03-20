PREFIX ?= /usr/local
ETCDIR ?= /usr/share/wolp
CONFIGDIR ?= $(PREFIX)/etc/wolp
BINDIR ?= $(PREFIX)/bin
SYSTEMD_DIR ?= /etc/systemd/system
INSTALL_WEBUI ?= 1

all:
	@echo "build wolp"
	cd client/src && go build -o ../../wolp main.go

install:
	@echo "Use 'make install' to install the service."
	# 安装可执行文件
	install -d $(BINDIR)
	install -m 755 wolp $(BINDIR)/wolp

	# 安装配置文件
	install -d $(CONFIGDIR)
	install -m 644 client/wolp.json $(CONFIGDIR)/wolp.json

	# 按需安装 webui
	if [ "$(INSTALL_WEBUI)" != "0" ]; then \
		install -d $(ETCDIR)/webui; \
		install -d $(ETCDIR)/webui/css; \
		install -d $(ETCDIR)/webui/js; \
		install -m 644 client/webui/index.html $(ETCDIR)/webui/index.html; \
		install -m 644 client/webui/css/*.css $(ETCDIR)/webui/css/; \
		install -m 644 client/webui/js/*.js $(ETCDIR)/webui/js/; \
	fi

	# 安装 Systemd 服务文件
	if [ "$(INSTALL_WEBUI)" = "0" ]; then \
		sed 's#^ExecStart=/usr/local/bin/wolp$$#ExecStart=/usr/local/bin/wolp --backend-only#' client/systemd/wolp.service > $(SYSTEMD_DIR)/wolp.service; \
		chmod 644 $(SYSTEMD_DIR)/wolp.service; \
	else \
		install -m 644 client/systemd/wolp.service $(SYSTEMD_DIR)/wolp.service; \
	fi

	# 重新加载 systemd 并启用 wolp
	systemctl daemon-reload
	systemctl enable wolp
	systemctl start wolp

uninstall:
	# 停止并禁用服务
	systemctl stop wolp
	systemctl disable wolp

	# 删除文件
	rm -f $(BINDIR)/wolp
	rm -rf $(ETCDIR)
	rm -f $(SYSTEMD_DIR)/wolp.service

	# 重新加载 systemd
	systemctl daemon-reload

.PHONY: all install uninstall clean

clean:
	rm -rf wolp
