/**
 * 倒计时模块
 */

const Countdown = {
    interval: null,

    /**
     * 更新倒计时显示
     */
    async update() {
        try {
            const response = await API.getRemaining();
            const remaining = parseInt(await response.text());

            const el = document.getElementById('remainingTime');
            const indicator = document.getElementById('statusIndicator');

            el.value = remaining;

            if (remaining > 0) {
                el.classList.add('countdown-active');
                indicator.className = 'status-indicator status-offline';
            } else {
                el.classList.remove('countdown-active');
                indicator.className = 'status-indicator status-online';
            }
        } catch (error) {
            console.error('获取剩余时间失败:', error);
        }
    },

    /**
     * 开始倒计时
     */
    start() {
        this.stop(); // 先停止现有的
        this.update();
        this.interval = setInterval(() => this.update(), 1000);
    },

    /**
     * 停止倒计时
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    },

    /**
     * 取消关机
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async cancel() {
        const authHeader = Session.getAuthHeader();

        try {
            const response = await API.cancelShutdown(authHeader);

            if (response.status === 401) {
                Auth.logout();
                UI.showLoginMessage('认证已过期，请重新登录');
                return { success: false, message: '认证已过期' };
            }

            return { success: true, message: '关机已取消！' };
        } catch (error) {
            return { success: false, message: '取消失败！' };
        }
    }
};
