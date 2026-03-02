/**
 * 附加数据输入框模块
 * 处理 WOL 协议的附加数据输入验证和格式化
 */

const ExtraInput = {
    // 配置
    config: {
        bytes: 6,              // 6 字节
        separator: ':',        // 分隔符
        pattern: /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/,  // XX:XX:XX:XX:XX:XX
        hexPattern: /^[0-9A-Fa-f:]*$/
    },

    elements: {
        input: null,
        wrapper: null,
        byteCount: null,
        statusIcon: null
    },

    /**
     * 初始化
     */
    init() {
        this.elements.input = document.getElementById('extra');
        this.elements.wrapper = this.elements.input?.parentElement;
        this.elements.byteCount = document.getElementById('extraByteCount');
        this.elements.statusIcon = document.getElementById('extraStatusIcon');

        if (!this.elements.input) return;

        this.bindEvents();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        const input = this.elements.input;

        // 输入时格式化和验证
        input.addEventListener('input', (e) => {
            this.handleInput(e);
        });

        // 失去焦点时验证
        input.addEventListener('blur', () => {
            this.validate();
        });

        // 获得焦点时选中内容
        input.addEventListener('focus', () => {
            input.select();
        });
    },

    /**
     * 处理输入
     */
    handleInput(e) {
        let value = e.target.value.toUpperCase();

        // 只允许十六进制字符和冒号
        if (!this.config.hexPattern.test(value)) {
            value = value.replace(/[^0-9A-F:]/g, '');
        }

        // 自动格式化：每两个字符后添加冒号
        value = this.formatValue(value);

        // 限制最大长度
        const maxLength = this.config.bytes * 3 - 1; // 6*3-1 = 17 (XX:XX:XX:XX:XX:XX)
        if (value.length > maxLength) {
            value = value.substring(0, maxLength);
        }

        e.target.value = value;
        this.updateByteCount();
        this.validate();
    },

    /**
     * 格式化值（自动添加冒号）
     */
    formatValue(value) {
        // 移除所有冒号
        const clean = value.replace(/:/g, '');

        // 添加冒号
        const parts = [];
        for (let i = 0; i < clean.length; i += 2) {
            parts.push(clean.substring(i, i + 2));
        }

        return parts.join(':');
    },

    /**
     * 验证输入
     */
    validate() {
        const value = this.elements.input.value;
        const isValid = this.config.pattern.test(value);
        const isEmpty = value === '';

        // 移除所有状态类
        this.elements.wrapper.classList.remove('valid', 'invalid');

        if (isEmpty) {
            this.setStatusIcon('info');
            this.elements.byteCount.classList.remove('valid');
            return { valid: true, empty: true };
        }

        if (isValid) {
            this.elements.wrapper.classList.add('valid');
            this.setStatusIcon('check');
            this.elements.byteCount.classList.add('valid');
            return { valid: true, empty: false };
        } else {
            this.elements.wrapper.classList.add('invalid');
            this.setStatusIcon('error');
            this.elements.byteCount.classList.remove('valid');
            return { valid: false, empty: false };
        }
    },

    /**
     * 设置状态图标
     */
    setStatusIcon(type) {
        const icon = this.elements.statusIcon;
        if (!icon) return;

        const icons = {
            info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
            check: '<polyline points="20 6 9 17 4 12"></polyline>',
            error: '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>'
        };

        icon.innerHTML = icons[type] || icons.info;
    },

    /**
     * 更新字节计数
     */
    updateByteCount() {
        const value = this.elements.input.value;
        const clean = value.replace(/:/g, '');
        const bytes = Math.ceil(clean.length / 2);

        this.elements.byteCount.textContent = `${bytes}/${this.config.bytes}`;
    },

    /**
     * 获取值（供外部调用）
     */
    getValue() {
        return this.elements.input.value;
    },

    /**
     * 设置值（供外部调用）
     */
    setValue(value) {
        this.elements.input.value = this.formatValue(value.toUpperCase());
        this.updateByteCount();
        this.validate();
    },

    /**
     * 清空值
     */
    clear() {
        this.elements.input.value = '';
        this.updateByteCount();
        this.validate();
    }
};

// 全局函数（用于 HTML onclick 绑定）
function setExampleExtra() {
    ExtraInput.setValue('12:34:56:78:9A:BC');
}
