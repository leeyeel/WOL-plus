/**
 * 认证模块
 */

const Auth = {
    /**
     * 生成 Basic Auth 头
     * @param {string} username - 用户名
     * @param {string} password - 密码
     * @returns {string} Basic Auth 头
     */
    createAuthHeader(username, password) {
        return 'Basic ' + btoa(username + ':' + password);
    },

    /**
     * 验证登录凭据
     * @param {string} username - 用户名
     * @param {string} password - 密码
     * @returns {boolean} 是否有效
     */
    validateCredentials(username, password) {
        return Boolean(username && password);
    },

    /**
     * 登录
     * @param {string} username - 用户名
     * @param {string} password - 密码
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async login(username, password) {
        if (!this.validateCredentials(username, password)) {
            return { success: false, error: '请输入用户名和密码' };
        }

        const authHeader = this.createAuthHeader(username, password);

        try {
            const response = await API.getConfig(authHeader);

            if (response.ok) {
                // 存储认证信息
                Session.setAuthHeader(authHeader);
                Session.setUsername(username);
                return { success: true };
            }

            return { success: false, error: '用户名或密码错误' };
        } catch (error) {
            return { success: false, error: '网络错误，请稍后重试' };
        }
    },

    /**
     * 登出
     */
    logout() {
        Session.clear();
        UI.showLoginView();
    }
};
