'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');

const providers = [{
    id: 'ollama-cloud-1',
    name: 'Ollama Cloud',
    type: 'ollama-cloud',
    models: [
        'deepseek-v4.1-flash:1017',
        'deepseek-v4-pro',
        'deepseek-v4.1-flash',
        'kimi-k2.7-code'
    ]
}];

const storage = {
    PROVIDERS: providers,
    ACTIVE_PROVIDER_ID: 'ollama-cloud-1',
    ACTIVE_MODEL: 'deepseek-v4.1-flash:1017'
};

const sandbox = {
    console,
    chrome: {
        runtime: {
            getURL(resourcePath) {
                return resourcePath;
            },
            onMessage: {
                addListener() {}
            },
            sendMessage() {}
        },
        storage: {
            local: {
                get(keys) {
                    const result = {};
                    (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
                        if (Object.prototype.hasOwnProperty.call(storage, key)) {
                            result[key] = storage[key];
                        }
                    });
                    return Promise.resolve(result);
                },
                set(values) {
                    Object.assign(storage, values);
                    return Promise.resolve();
                }
            }
        }
    },
    document: {
        readyState: 'complete'
    },
    window: {
        location: {
            href: 'about:blank'
        }
    }
};

sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${contentScript}
globalThis.__lockedReasoningExports = {
    updateProviderDisplay,
    getReasoningCapability
};`, sandbox, {
    filename: 'content.js'
});

const { updateProviderDisplay, getReasoningCapability } = sandbox.__lockedReasoningExports;

function createElement(id) {
    const attributes = new Map();
    return {
        id,
        isConnected: true,
        hidden: false,
        textContent: '',
        title: '',
        min: '0',
        max: '0',
        step: '1',
        value: '0',
        dataset: {},
        style: {
            setProperty() {}
        },
        getAttribute(name) {
            return attributes.has(name) ? attributes.get(name) : null;
        },
        hasAttribute(name) {
            return attributes.has(name);
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        removeAttribute(name) {
            attributes.delete(name);
        }
    };
}

function createDialogElements() {
    return {
        'gemini-qna-input': createElement('gemini-qna-input'),
        'provider-display-model': createElement('provider-display-model'),
        'askpage-reasoning-control': createElement('askpage-reasoning-control'),
        'askpage-reasoning-popover': createElement('askpage-reasoning-popover'),
        'askpage-reasoning-slider': createElement('askpage-reasoning-slider'),
        'askpage-reasoning-value': createElement('askpage-reasoning-value'),
        'askpage-reasoning-hint': createElement('askpage-reasoning-hint')
    };
}

function applyDialogElements(elements) {
    vm.runInContext('activeDialogState = { elements: globalThis.__elements, host: { isConnected: true } };', sandbox);
    sandbox.__elements = elements;
    vm.runInContext('activeDialogState.elements = globalThis.__elements;', sandbox);
}

function isReasoningUiHidden(elements) {
    return elements['askpage-reasoning-popover'].hidden === true &&
        elements['askpage-reasoning-control'].hasAttribute('data-reasoning-configurable') === false;
}

function isReasoningUiVisible(elements) {
    return elements['askpage-reasoning-popover'].hidden === false &&
        elements['askpage-reasoning-control'].getAttribute('data-reasoning-configurable') === 'true';
}

(async () => {
    // 固定 max 的模型：推理強度 UI 完全隱藏。
    for (const model of ['deepseek-v4.1-flash:1017', 'deepseek-v4-pro', 'deepseek-v4.1-flash']) {
        storage.ACTIVE_MODEL = model;
        const elements = createDialogElements();
        applyDialogElements(elements);
        await updateProviderDisplay();
        assert.strictEqual(
            isReasoningUiHidden(elements),
            true,
            `${model} should hide the reasoning strength control`
        );
        assert.strictEqual(
            elements['askpage-reasoning-slider'].value,
            '0',
            `${model} should not configure a reasoning slider`
        );
    }

    // 固定 max 的模型不會寫入可調整的推理強度值。
    for (const model of ['deepseek-v4.1-flash:1017', 'deepseek-v4-pro', 'deepseek-v4.1-flash']) {
        const capability = getReasoningCapability('ollama-cloud', model);
        assert.strictEqual(capability.locked, true, `${model} should be locked`);
        assert.strictEqual(capability.defaultValue, 'max', `${model} should default to max`);
        assert.deepStrictEqual(Array.from(capability.options), ['max'], `${model} should only offer max`);
    }

    // 可調整的模型維持原本的滑桿控制。
    storage.ACTIVE_MODEL = 'kimi-k2.7-code';
    const kimiElements = createDialogElements();
    applyDialogElements(kimiElements);
    await updateProviderDisplay();
    assert.strictEqual(isReasoningUiVisible(kimiElements), true, 'kimi-k2.7-code should show the reasoning control');
    assert.strictEqual(kimiElements['askpage-reasoning-slider'].max, '4');

    // 沒有推理能力的模型維持隱藏。
    storage.ACTIVE_MODEL = 'gpt-oss:120b';
    const plainElements = createDialogElements();
    applyDialogElements(plainElements);
    await updateProviderDisplay();
    assert.strictEqual(isReasoningUiHidden(plainElements), true, 'gpt-oss:120b should hide the reasoning control');

    console.log('locked-reasoning-max: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
