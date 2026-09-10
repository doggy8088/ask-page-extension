'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const i18nScript = fs.readFileSync(path.join(rootDir, 'i18n.js'), 'utf8');
const zhTwCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, '_locales', 'zh_TW', 'messages.json'), 'utf8'));

const warnings = [];
const debugMessages = [];
const sentMessages = [];
const sandbox = {
    chrome: {
        i18n: {
            getUILanguage() {
                return 'zh-TW';
            }
        },
        runtime: {
            getURL(resourcePath) {
                return resourcePath;
            },
            async sendMessage(message) {
                sentMessages.push(message);
                assert.strictEqual(message.action, 'get-locale-catalog');
                return { success: true, catalog: zhTwCatalog };
            }
        },
        storage: {
            local: {
                async get(keys) {
                    return { ASKPAGE_UI_LOCALE: 'auto' };
                },
                async set() {}
            },
            onChanged: {
                addListener() {}
            }
        }
    },
    // Simulate a strict-CSP page where a content-script fetch of an
    // extension URL is rejected with the reported symptom.
    fetch: async () => {
        throw new TypeError('Failed to fetch');
    },
    MutationObserver: class {
        observe() {}
    },
    console: {
        warn(...args) {
            warnings.push(args.map(String).join(' '));
        },
        debug(...args) {
            debugMessages.push(args.map(String).join(' '));
        },
        error() {},
        log() {}
    }
};

sandbox.globalThis = sandbox;
sandbox.document = { readyState: 'complete', addEventListener() {} };
vm.createContext(sandbox);
vm.runInContext(i18nScript, sandbox, { filename: 'i18n.js' });

(async () => {
    const i18n = sandbox.AskPageI18n;
    await i18n.ready;

    assert.strictEqual(i18n.locale, 'zh_TW');
    assert.strictEqual(i18n.t('cancel'), '取消');
    assert.deepStrictEqual(sentMessages.map((message) => message.locale), ['zh_TW']);
    assert.strictEqual(
        warnings.some((warning) => warning.includes('Failed to load locale catalog')),
        false
    );
    assert.strictEqual(
        debugMessages.some((message) => message.includes('trying background')),
        true
    );

    console.log('locale-catalog-csp-fallback: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
