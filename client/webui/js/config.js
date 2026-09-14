/**
 * 配置管理模块
 */

const Config = {
    supportsExtraData: null,
    settingsBaseline: null,

    async getErrorMessage(response, fallback) {
        const message = (await response.text()).trim();

        if (response.status === 400 && message === 'Failed to parse config') {
            return I18n.t('error.oldService');
        }

        return message || `${fallback} (HTTP ${response.status})`;
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
            extra_data: ExtraInput.getValue(),
            shutdown_delay: document.getElementById('shutdownTime').value.trim()
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
        document.getElementById('newPassword').value = '';
        this.settingsBaseline = {
            username: document.getElementById('usernameInput').value,
            extra_data: ExtraInput.getValue(),
            shutdown_delay: document.getElementById('shutdownTime').value
        };
    },

    /**
     * 判断输入的密码是否与当前会话凭据一致
     * @param {string} password - 待比较密码
     * @returns {boolean} 是否为当前密码
     */
    isCurrentPassword(password) {
        const authHeader = Session.getAuthHeader();
        const prefix = 'Basic ';

        if (!authHeader.startsWith(prefix)) return false;

        try {
            const credentials = atob(authHeader.slice(prefix.length));
            const separator = credentials.indexOf(':');
            return separator >= 0 && credentials.slice(separator + 1) === password;
        } catch (error) {
            return false;
        }
    },

    /**
     * 保存设置
     * @returns {Promise<{success: boolean, message: string, needRelogin?: boolean, unchanged?: boolean}>}
     */
    async saveSettings() {
        if (this.supportsExtraData === false) {
            return { success: false, message: I18n.t('error.unsupportedExtraData') };
        }

        const settings = this.readSettingsFromDOM();
        const controlKey = ExtraInput.validate();

        if (!/^\d+$/.test(settings.shutdown_delay)) {
            return { success: false, message: I18n.t('error.delay') };
        }

        if (!controlKey.valid) {
            return { success: false, message: I18n.t('error.controlKey') };
        }

        const payload = {};
        const settingsFields = ['username', 'extra_data', 'shutdown_delay'];
        settingsFields.forEach((field) => {
            if (!this.settingsBaseline || settings[field] !== this.settingsBaseline[field]) {
                payload[field] = settings[field];
            }
        });

        const passwordChanged = Boolean(settings.password) && !this.isCurrentPassword(settings.password);
        if (passwordChanged) {
            payload.password = settings.password;
        }

        if (Object.keys(payload).length === 0) {
            document.getElementById('newPassword').value = '';
            return { success: true, message: I18n.t('success.unchanged'), unchanged: true };
        }

        const authHeader = Session.getAuthHeader();
        const credentialsChanged = Object.prototype.hasOwnProperty.call(payload, 'username') || passwordChanged;

        try {
            const response = await API.saveConfig(payload, authHeader);

            if (response.ok) {
                if (credentialsChanged) {
                    return {
                        success: true,
                        message: I18n.t('success.saved'),
                        needRelogin: true
                    };
                }
                return { success: true, message: I18n.t('success.saved') };
            }

            if (response.status === 401) {
                Auth.logout();
                UI.showLoginMessage(I18n.t('error.authExpiredRelogin'));
                return { success: false, message: I18n.t('error.authExpired') };
            }

            return { success: false, message: await this.getErrorMessage(response, I18n.t('error.saveFailed')) };
        } catch (error) {
            return { success: false, message: I18n.t('error.networkSaveFailed') };
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
