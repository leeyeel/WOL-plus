/**
 * 主入口文件
 */

// 应用状态
const App = {
    /**
     * 初始化应用
     */
    async init() {
        // 初始化附加数据输入模块
        ExtraInput.init();

        this.bindEvents();

        // 如果有缓存的认证信息，验证是否仍然有效
        if (Session.isLoggedIn()) {
            const isValid = await this.verifySession();
            if (isValid) {
                UI.showConfigView();
                await Config.load();
                Countdown.start();
            } else {
                // 认证失效，清除缓存并显示登录页
                Session.clear();
            }
        }
    },

    /**
     * 验证缓存的会话是否仍然有效
     */
    async verifySession() {
        try {
            const authHeader = Session.getAuthHeader();
            const response = await API.getConfig(authHeader);
            return response.ok;
        } catch (error) {
            return false;
        }
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 登录表单 - 回车键登录
        document.getElementById('password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleLogin();
            }
        });
    },

    /**
     * 处理登录
     */
    async handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        const result = await Auth.login(username, password);

        if (result.success) {
            UI.showConfigView();
            await Config.load();
            Countdown.start();
        } else {
            UI.showLoginMessage(result.error);
        }
    },

    /**
     * 处理保存配置
     */
    async handleSaveConfig() {
        const result = await Config.save();
        UI.showMessage(result.message, result.success ? 'success' : 'error');
    },

    /**
     * 处理取消关机
     */
    async handleCancelShutdown() {
        const result = await Countdown.cancel();
        if (result.success) {
            UI.showMessage(result.message, 'success');
        }
    },

    /**
     * 处理保存设置
     */
    async handleSaveSettings() {
        const result = await Config.saveSettings();
        UI.showSettingsMessage(result.message, result.success ? 'success' : 'error');

        if (result.needRelogin) {
            setTimeout(() => {
                Auth.logout();
                UI.showLoginMessage('密码已修改，请重新登录');
            }, 1500);
        }
    }
};

// 全局函数（用于 HTML onclick 绑定）
function login() {
    App.handleLogin();
}

function logout() {
    Auth.logout();
}

function showSettings() {
    UI.showSettings();
}

function hideSettings() {
    UI.hideSettings();
}

function saveConfig() {
    App.handleSaveConfig();
}

function cancelShutdown() {
    App.handleCancelShutdown();
}

function saveSettings() {
    App.handleSaveSettings();
}

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
