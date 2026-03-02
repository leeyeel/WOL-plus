/**
 * API 调用封装模块
 */

const API = {
    /**
     * 获取配置
     * @param {string} authHeader - 认证头
     * @returns {Promise<Response>}
     */
    getConfig(authHeader) {
        return fetch('/api/config', {
            headers: { 'Authorization': authHeader }
        });
    },

    /**
     * 保存配置
     * @param {Object} payload - 配置数据
     * @param {string} authHeader - 认证头
     * @returns {Promise<Response>}
     */
    saveConfig(payload, authHeader) {
        return fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader
            },
            body: JSON.stringify(payload)
        });
    },

    /**
     * 获取剩余时间
     * @returns {Promise<Response>}
     */
    getRemaining() {
        return fetch('/api/remaining');
    },

    /**
     * 取消关机
     * @param {string} authHeader - 认证头
     * @returns {Promise<Response>}
     */
    cancelShutdown(authHeader) {
        return fetch('/api/cancel', {
            method: 'POST',
            headers: { 'Authorization': authHeader }
        });
    }
};
