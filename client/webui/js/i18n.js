/**
 * Client Web UI translations.
 * The selected language is stored locally so it survives page reloads.
 */
const I18n = {
    STORAGE_KEY: 'wol_language',
    supported: ['zh-CN', 'en'],
    language: 'zh-CN',
    preference: 'auto',
    messages: {
        'zh-CN': {
            'app.title': 'WOL Plus 配置',
            'language.label': '语言',
            'language.help': '立即生效，自动记住选择，无需保存。',
            'language.auto': '跟随浏览器',
            'language.zh': '中文',
            'language.en': 'English',
            'login.username': '用户名',
            'login.usernamePlaceholder': '请输入用户名',
            'login.password': '密码',
            'login.passwordPlaceholder': '请输入密码',
            'login.submit': '登 录',
            'main.settings': '设置',
            'main.logout': '退出登录',
            'main.countdown': '关机倒计时',
            'main.seconds': '秒',
            'main.mac': 'MAC 地址',
            'main.interface': '网络接口',
            'main.cancelShutdown': '取消关机',
            'settings.back': '返回',
            'settings.title': '系统设置',
            'settings.shutdownDelay': '关机延时（秒）',
            'settings.controlKey': '关机控制密钥',
            'settings.keyByte': '关机控制密钥第 {n} 字节',
            'settings.usernameHelp': '用于登录当前客户端 Web 管理页面',
            'settings.newPassword': '新密码',
            'settings.passwordPlaceholder': '留空则不修改',
            'settings.passwordHelp': '修改密码后需要重新登录，OpenWrt 发送端配置不受影响',
            'settings.save': '保存设置',
            'status.shutdownInProgress': '关机倒计时进行中',
            'status.noShutdown': '未计划关机',
            'error.credentialsRequired': '请输入用户名和密码',
            'error.credentialsInvalid': '用户名或密码错误',
            'error.networkRetry': '网络错误，请稍后重试',
            'error.authExpired': '认证已过期',
            'error.authExpiredRelogin': '认证已过期，请重新登录',
            'error.cancelFailed': '取消失败！',
            'success.cancelled': '关机已取消！',
            'error.unsupportedExtraData': '当前客户端服务版本不支持关机控制密钥，请同时升级 wolp 服务端和 Web 页面。',
            'error.delay': '关机延时必须为非负整数秒',
            'error.controlKey': '关机控制密钥必须为 6 字节十六进制数',
            'success.unchanged': '设置未变更',
            'success.saved': '设置已保存！',
            'error.saveFailed': '保存失败！',
            'error.networkSaveFailed': '网络错误，保存失败！',
            'success.passwordChanged': '密码已修改，请重新登录',
            'error.oldService': '当前客户端服务版本不支持关机控制密钥，请同时升级 wolp 服务端和 Web 页面。'
        },
        en: {
            'app.title': 'WOL Plus Configuration',
            'language.label': 'Language',
            'language.help': 'Applies immediately. Your choice is remembered automatically.',
            'language.auto': 'Browser default',
            'language.zh': '中文',
            'language.en': 'English',
            'login.username': 'Username',
            'login.usernamePlaceholder': 'Enter username',
            'login.password': 'Password',
            'login.passwordPlaceholder': 'Enter password',
            'login.submit': 'LOG IN',
            'main.settings': 'Settings',
            'main.logout': 'Log out',
            'main.countdown': 'Shutdown countdown',
            'main.seconds': 'seconds',
            'main.mac': 'MAC address',
            'main.interface': 'Network interface',
            'main.cancelShutdown': 'Cancel shutdown',
            'settings.back': 'Back',
            'settings.title': 'System settings',
            'settings.shutdownDelay': 'Shutdown delay (seconds)',
            'settings.controlKey': 'Shutdown control key',
            'settings.keyByte': 'Shutdown control key byte {n}',
            'settings.usernameHelp': 'Used to sign in to this client Web management page',
            'settings.newPassword': 'New password',
            'settings.passwordPlaceholder': 'Leave blank to keep unchanged',
            'settings.passwordHelp': 'You must sign in again after changing the password. OpenWrt sender settings are not affected.',
            'settings.save': 'Save settings',
            'status.shutdownInProgress': 'Shutdown countdown in progress',
            'status.noShutdown': 'No shutdown scheduled',
            'error.credentialsRequired': 'Username and password are required',
            'error.credentialsInvalid': 'Invalid username or password',
            'error.networkRetry': 'Network error. Please try again later.',
            'error.authExpired': 'Authentication expired',
            'error.authExpiredRelogin': 'Authentication expired. Please sign in again.',
            'error.cancelFailed': 'Failed to cancel shutdown.',
            'success.cancelled': 'Shutdown cancelled!',
            'error.unsupportedExtraData': 'This client service does not support the shutdown control key. Upgrade both the wolp service and Web UI.',
            'error.delay': 'Shutdown delay must be a non-negative number of seconds',
            'error.controlKey': 'Shutdown control key must contain 6 hexadecimal bytes',
            'success.unchanged': 'No settings changed',
            'success.saved': 'Settings saved!',
            'error.saveFailed': 'Failed to save settings!',
            'error.networkSaveFailed': 'Network error. Failed to save settings!',
            'success.passwordChanged': 'Password changed. Please sign in again.',
            'error.oldService': 'This client service does not support the shutdown control key. Upgrade both the wolp service and Web UI.'
        }
    },

    init() {
        let stored;
        try { stored = localStorage.getItem(this.STORAGE_KEY); } catch (_) { /* Storage is optional. */ }
        this.setLanguage(this.supported.includes(stored) ? stored : 'auto', false);
        document.querySelectorAll('[data-language-select]').forEach((select) => {
            select.addEventListener('change', (event) => this.setLanguage(event.target.value));
        });
        window.addEventListener('languagechange', () => {
            if (this.preference === 'auto') this.setLanguage('auto', false);
        });
        window.addEventListener('storage', (event) => {
            if (event.key === this.STORAGE_KEY || event.key === null) {
                this.setLanguage(this.supported.includes(event.newValue) ? event.newValue : 'auto', false);
            }
        });
    },

    setLanguage(language, persist = true) {
        if (language !== 'auto' && !this.supported.includes(language)) return;
        const previous = this.language;
        this.preference = language;
        const languages = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
        const match = languages.find((value) => /^(zh|en)(-|$)/i.test(value));
        this.language = language === 'auto' ? (/^zh/i.test(match || '') ? 'zh-CN' : 'en') : language;
        if (persist) {
            try { localStorage.setItem(this.STORAGE_KEY, language); } catch (_) { /* Keep working in memory. */ }
        }
        // Existing transient messages also follow the selected language.
        ['loginMessage', 'message', 'settingsMessage'].forEach((id) => {
            const element = document.getElementById(id);
            if (!element || !element.textContent) return;
            const key = Object.keys(this.messages[previous]).find((key) => this.messages[previous][key] === element.textContent);
            if (key) element.textContent = this.t(key);
        });
        this.apply();
    },

    t(key, variables = {}) {
        let value = this.messages[this.language][key] || this.messages['zh-CN'][key] || key;
        return value.replace(/\{(\w+)\}/g, (_, name) => variables[name] ?? `{${name}}`);
    },

    apply() {
        document.documentElement.lang = this.language === 'en' ? 'en' : 'zh-CN';
        document.title = this.t('app.title');
        document.querySelectorAll('[data-i18n]').forEach((element) => {
            element.textContent = this.t(element.dataset.i18n);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
            element.placeholder = this.t(element.dataset.i18nPlaceholder);
        });
        document.querySelectorAll('[data-i18n-title]').forEach((element) => {
            element.title = this.t(element.dataset.i18nTitle);
        });
        document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
            const variables = element.dataset.byteIndex ? { n: element.dataset.byteIndex } : {};
            element.setAttribute('aria-label', this.t(element.dataset.i18nAriaLabel, variables));
        });
        document.querySelectorAll('[data-language-select]').forEach((select) => {
            select.value = this.preference;
        });
        document.querySelectorAll('[data-language-label]').forEach((element) => {
            element.textContent = `${this.t('language.label')}:`;
        });
        const indicator = document.getElementById('statusIndicator');
        if (indicator) indicator.setAttribute('aria-label', this.t(
            indicator.classList.contains('status-offline') ? 'status.shutdownInProgress' : 'status.noShutdown'
        ));
    }
};
