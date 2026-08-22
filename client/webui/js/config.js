/**
 * 配置管理模块
 */

const Config = {
    supportsExtraData: null,

    async getErrorMessage(response, fallback) {
        const message = (await response.text()).trim();

        if (response.status === 400 && message === 'Failed to parse config') {
            return '当前客户端服务版本不支持关机控制密钥，请同时升级 wolp 服务端和 Web 页面。';
        }

        return message || `${fallback}（HTTP ${response.status}）`;
    },

    /**
     * 从 DOM 读取配置数据
     * @returns {Object} 配置对象
     */
    readFromDOM() {
        return {
            mac_address: document.getElementById('mac').value.trim(),
            shutdown_delay: document.getElementById('shutdownTime').value.trim()
        };
    },

    /**
     * 读取设置数据
     * @returns {Object} 设置对象
     */
    readSettingsFromDOM() {
        const username = document.getElementById('usernameInput').value.trim();
        const newPassword = document.getElementById('newPassword').value;
        const payload = {
            username,
            extra_data: ExtraInput.getValue()
        };

        if (newPassword) {
            payload.password = newPassword;
        }

        return payload;
    },

    /**
     * 将配置填充到 DOM
     * @param {Object} data - 配置数据
     */
    populateDOM(data) {
        this.supportsExtraData = Object.prototype.hasOwnProperty.call(data, 'extra_data');
        document.getElementById('mac').value = data.mac_address || '';
        ExtraInput.setValue(data.extra_data || 'FF:FF:FF:FF:FF:FF');
        document.getElementById('shutdownTime').value = data.shutdown_delay || '60';
        document.getElementById('usernameInput').value = data.username || 'admin';
        document.getElementById('networkInterface').value = data.interface || '';
    },

    /**
     * 保存配置
     * @returns {Promise<{success: boolean, message: string, needRelogin?: boolean}>}
     */
    async save() {
        const payload = this.readFromDOM();
        const authHeader = Session.getAuthHeader();

        try {
            const response = await API.saveConfig(payload, authHeader);

            if (response.ok) {
                return { success: true, message: '配置已成功更新！' };
            }

            if (response.status === 401) {
                Auth.logout();
                UI.showLoginMessage('认证已过期，请重新登录');
                return { success: false, message: '认证已过期' };
            }

            return { success: false, message: await this.getErrorMessage(response, '更新配置失败！') };
        } catch (error) {
            return { success: false, message: '网络错误，保存失败！' };
        }
    },

    /**
     * 保存设置
     * @returns {Promise<{success: boolean, message: string, needRelogin?: boolean}>}
     */
    async saveSettings() {
        if (this.supportsExtraData === false) {
            return { success: false, message: '当前客户端服务版本不支持关机控制密钥，请同时升级 wolp 服务端和 Web 页面。' };
        }

        const payload = this.readSettingsFromDOM();
        const authHeader = Session.getAuthHeader();
        const passwordChanged = Boolean(payload.password);
        const controlKey = ExtraInput.validate();

        if (!controlKey.valid) {
            return { success: false, message: '关机控制密钥必须为 6 字节十六进制数' };
        }

        try {
            const response = await API.saveConfig(payload, authHeader);

            if (response.ok) {
                if (passwordChanged) {
                    return {
                        success: true,
                        message: '设置已保存！',
                        needRelogin: true
                    };
                }
                return { success: true, message: '设置已保存！' };
            }

            if (response.status === 401) {
                Auth.logout();
                UI.showLoginMessage('认证已过期，请重新登录');
                return { success: false, message: '认证已过期' };
            }

            return { success: false, message: await this.getErrorMessage(response, '保存失败！') };
        } catch (error) {
            return { success: false, message: '网络错误，保存失败！' };
        }
    },

    /**
     * 加载配置
     * @returns {Promise<boolean>} 是否成功
     */
    async load() {
        const authHeader = Session.getAuthHeader();

        try {
            const response = await API.getConfig(authHeader);
            const data = await response.json();
            this.populateDOM(data);
            return true;
        } catch (error) {
            console.error('加载配置失败:', error);
            return false;
        }
    }
};
