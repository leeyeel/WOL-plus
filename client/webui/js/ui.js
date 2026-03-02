/**
 * UI 交互模块
 */

const UI = {
    /**
     * 显示登录视图
     */
    showLoginView() {
        document.getElementById('loginContainer').style.display = 'block';
        document.getElementById('configContainer').style.display = 'none';
        this.clearLoginForm();
    },

    /**
     * 显示配置视图
     */
    showConfigView() {
        document.getElementById('loginContainer').style.display = 'none';
        document.getElementById('configContainer').style.display = 'block';
        this.hideSettings();
    },

    /**
     * 显示设置面板
     */
    showSettings() {
        document.getElementById('mainPanel').style.display = 'none';
        document.getElementById('settingsPanel').classList.add('show');
    },

    /**
     * 隐藏设置面板
     */
    hideSettings() {
        document.getElementById('mainPanel').style.display = 'block';
        document.getElementById('settingsPanel').classList.remove('show');
    },

    /**
     * 清空登录表单
     */
    clearLoginForm() {
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        document.getElementById('loginMessage').textContent = '';
    },

    /**
     * 显示登录消息
     * @param {string} msg - 消息内容
     */
    showLoginMessage(msg) {
        const el = document.getElementById('loginMessage');
        el.textContent = msg;
        el.style.background = 'rgba(220, 53, 69, 0.1)';
    },

    /**
     * 显示配置消息
     * @param {string} text - 消息内容
     * @param {string} type - 消息类型 (success/error)
     * @param {number} duration - 显示时长（毫秒）
     */
    showMessage(text, type = 'success', duration = 3000) {
        const el = document.getElementById('message');
        el.textContent = text;
        el.style.background = type === 'success'
            ? 'rgba(40, 167, 69, 0.1)'
            : 'rgba(220, 53, 69, 0.1)';
        el.style.color = type === 'success' ? '#28a745' : '#dc3545';

        setTimeout(() => {
            el.textContent = '';
        }, duration);
    },

    /**
     * 显示设置消息
     * @param {string} text - 消息内容
     * @param {string} type - 消息类型 (success/error)
     * @param {number} duration - 显示时长（毫秒）
     */
    showSettingsMessage(text, type = 'success', duration = 3000) {
        const el = document.getElementById('settingsMessage');
        el.textContent = text;
        el.style.background = type === 'success'
            ? 'rgba(40, 167, 69, 0.1)'
            : 'rgba(220, 53, 69, 0.1)';
        el.style.color = type === 'success' ? '#28a745' : '#dc3545';

        setTimeout(() => {
            el.textContent = '';
        }, duration);
    }
};
