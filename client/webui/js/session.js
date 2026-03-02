/**
 * 会话管理模块
 */

const Session = {
    STORAGE_KEY_AUTH: 'wol_auth_header',
    STORAGE_KEY_USERNAME: 'wol_username',

    /**
     * 设置认证头
     * @param {string} authHeader - 认证头
     */
    setAuthHeader(authHeader) {
        sessionStorage.setItem(this.STORAGE_KEY_AUTH, authHeader);
    },

    /**
     * 获取认证头
     * @returns {string} 认证头
     */
    getAuthHeader() {
        return sessionStorage.getItem(this.STORAGE_KEY_AUTH) || '';
    },

    /**
     * 设置用户名
     * @param {string} username - 用户名
     */
    setUsername(username) {
        sessionStorage.setItem(this.STORAGE_KEY_USERNAME, username);
    },

    /**
     * 获取用户名
     * @returns {string} 用户名
     */
    getUsername() {
        return sessionStorage.getItem(this.STORAGE_KEY_USERNAME) || '';
    },

    /**
     * 清除会话
     */
    clear() {
        sessionStorage.removeItem(this.STORAGE_KEY_AUTH);
        sessionStorage.removeItem(this.STORAGE_KEY_USERNAME);
        Countdown.stop();
    },

    /**
     * 检查是否已登录
     * @returns {boolean} 是否已登录
     */
    isLoggedIn() {
        return Boolean(this.getAuthHeader());
    }
};
