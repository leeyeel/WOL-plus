/**
 * 关机控制密钥输入框模块
 */

const ExtraInput = {
    config: {
        bytes: 6,
        bytePattern: /^[0-9A-F]{2}$/
    },

    elements: {
        inputs: [],
        wrapper: null,
        byteCount: null
    },

    init() {
        this.elements.wrapper = document.getElementById('extra');
        this.elements.inputs = Array.from(document.querySelectorAll('.hex-byte-input'));
        this.elements.byteCount = document.getElementById('extraByteCount');

        if (!this.elements.wrapper || this.elements.inputs.length !== this.config.bytes || !this.elements.byteCount) return;

        this.bindEvents();
    },

    bindEvents() {
        this.elements.inputs.forEach((input, index) => {
            input.addEventListener('input', (event) => {
                this.handleInput(event, index);
            });
            input.addEventListener('keydown', (event) => {
                this.handleKeydown(event, index);
            });
            input.addEventListener('paste', (event) => {
                this.handlePaste(event);
            });
            input.addEventListener('blur', () => {
                setTimeout(() => {
                    if (!this.elements.wrapper.contains(document.activeElement)) {
                        this.validate();
                    }
                }, 0);
            });
        });
    },

    cleanValue(value) {
        return String(value || '')
            .replace(/[^0-9A-Fa-f]/g, '')
            .slice(0, this.config.bytes * 2)
            .toUpperCase();
    },

    handleInput(event, index) {
        const input = event.target;
        input.value = this.cleanValue(input.value).slice(0, 2);

        this.updateByteCount();
        this.validate(false);

        if (input.value.length === 2 && index < this.config.bytes - 1) {
            this.elements.inputs[index + 1].focus();
            this.elements.inputs[index + 1].select();
        }
    },

    handleKeydown(event, index) {
        if (event.key !== 'Backspace' || event.target.value || index === 0) return;

        event.preventDefault();
        this.elements.inputs[index - 1].value = '';
        this.elements.inputs[index - 1].focus();
        this.updateByteCount();
        this.validate(false);
    },

    handlePaste(event) {
        event.preventDefault();
        this.setValue(event.clipboardData?.getData('text') || '');

        const next = this.elements.inputs.findIndex((input) => input.value.length < 2);
        this.elements.inputs[next === -1 ? this.config.bytes - 1 : next].focus();
    },

    formatValue(value) {
        const clean = this.cleanValue(value);

        const parts = [];
        for (let i = 0; i < clean.length; i += 2) {
            parts.push(clean.substring(i, i + 2));
        }

        return parts.join(':');
    },

    validate(showErrors = true) {
        const isEmpty = this.elements.inputs.every((input) => input.value === '');
        const isValid = this.elements.inputs.every((input) => this.config.bytePattern.test(input.value));

        this.elements.wrapper.classList.remove('valid', 'invalid');

        if (isValid) {
            this.elements.wrapper.classList.add('valid');
            this.elements.byteCount.classList.add('valid');
            return { valid: true, empty: false };
        }

        this.elements.byteCount.classList.remove('valid');
        if (showErrors) {
            this.elements.wrapper.classList.add('invalid');
        }

        return { valid: false, empty: isEmpty };
    },

    updateByteCount() {
        const bytes = this.elements.inputs.filter((input) => input.value.length === 2).length;

        this.elements.byteCount.textContent = `${bytes}/${this.config.bytes}`;
    },

    getValue() {
        return this.formatValue(this.elements.inputs.map((input) => input.value).join(''));
    },

    setValue(value) {
        const clean = this.cleanValue(value);

        this.elements.inputs.forEach((input, index) => {
            input.value = clean.slice(index * 2, index * 2 + 2);
        });
        this.updateByteCount();
        this.validate();
    },

    clear() {
        this.elements.inputs.forEach((input) => {
            input.value = '';
        });
        this.updateByteCount();
        this.validate();
    }
};
