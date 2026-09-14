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
            const response = await API.getRemaining(Session.getAuthHeader());
            const remaining = Math.max(0, parseInt(await response.text(), 10) || 0);

            const el = document.getElementById('remainingTime');
            const indicator = document.getElementById('statusIndicator');
            const cancelButton = document.getElementById('cancelShutdownButton');

            el.textContent = remaining;
            cancelButton.disabled = remaining === 0;

            if (remaining > 0) {
                el.classList.add('countdown-active');
                indicator.className = 'status-indicator status-offline';
                indicator.setAttribute('aria-label', I18n.t('status.shutdownInProgress'));
            } else {
                el.classList.remove('countdown-active');
                indicator.className = 'status-indicator status-online';
                indicator.setAttribute('aria-label', I18n.t('status.noShutdown'));
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
                UI.showLoginMessage(I18n.t('error.authExpiredRelogin'));
                return { success: false, message: I18n.t('error.authExpired') };
            }

            return { success: true, message: I18n.t('success.cancelled') };
        } catch (error) {
            return { success: false, message: I18n.t('error.cancelFailed') };
        }
    }
};
