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

        // 如果已登录，直接显示配置页面
        if (Session.isLoggedIn()) {
            UI.showConfigView();
            await Config.load();
            Countdown.start();
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
