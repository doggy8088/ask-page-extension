'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const i18nScript = fs.readFileSync(path.join(rootDir, 'i18n.js'), 'utf8');
const catalogs = Object.fromEntries(
    ['zh_TW', 'en', 'zh_CN', 'ja', 'ko'].map((locale) => [
        locale,
        JSON.parse(fs.readFileSync(path.join(rootDir, '_locales', locale, 'messages.json'), 'utf8'))
    ])
);
catalogs.en.testPositional = { message: '$1 / $2 / $9' };
catalogs.en.testDoubleBraces = { message: '{{name}}' };
catalogs.zh_TW.testFallback = { message: 'Fallback text' };
delete catalogs.ja.testFallback;

class FakeElement {
    constructor(tagName, parentElement = null) {
        this.nodeType = 1;
        this.tagName = tagName.toUpperCase();
        this.parentElement = parentElement;
        this.attributes = new Map();
        this.descendants = [];
        this.dataset = Object.create(null);
        this.textContent = '';
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            this.dataset[key] = String(value);
        }
    }

    querySelectorAll() {
        return this.descendants;
    }
}

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        FakeMutationObserver.instances.push(this);
    }

    observe() {}
}

FakeMutationObserver.instances = [];

const document = {
    nodeType: 9,
    documentElement: new FakeElement('html'),
    readyState: 'complete',
    addEventListener() {}
};

let storage = { ASKPAGE_UI_LOCALE: 'auto' };
let storageChangedListener = null;
const sandbox = {
    chrome: {
        i18n: {
            getUILanguage() {
                return 'en-US';
            }
        },
        runtime: {
            getURL(resourcePath) {
                return resourcePath;
            }
        },
        storage: {
            local: {
                async get(keys) {
                    if (!keys) {
                        return { ...storage };
                    }
                    return Object.fromEntries(keys.map((key) => [key, storage[key]]));
                },
                async set(values) {
                    const changes = {};
                    Object.entries(values).forEach(([key, value]) => {
                        changes[key] = { oldValue: storage[key], newValue: value };
                        storage[key] = value;
                    });
                    storageChangedListener?.(changes, 'local');
                }
            },
            onChanged: {
                addListener(listener) {
                    storageChangedListener = listener;
                }
            }
        }
    },
    document,
    MutationObserver: FakeMutationObserver,
    fetch: async (resourcePath) => {
        const locale = String(resourcePath).split('/')[1];
        return {
            ok: Boolean(catalogs[locale]),
            status: catalogs[locale] ? 200 : 404,
            async json() {
                return catalogs[locale];
            }
        };
    },
    console: {
        warn() {},
        error() {}
    }
};

sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(i18nScript, sandbox, { filename: 'i18n.js' });

(async () => {
    const i18n = sandbox.AskPageI18n;
    await i18n.ready;

    assert.deepStrictEqual(Array.from(i18n.SUPPORTED_LOCALES), ['zh_TW', 'en', 'zh_CN', 'ja', 'ko']);
    assert.strictEqual(i18n.locale, 'en');
    assert.strictEqual(i18n.direction, 'ltr');
    assert.strictEqual(i18n.t('systemPromptLanguageInstruction'), catalogs.en.systemPromptLanguageInstruction.message);
    assert.strictEqual(i18n.t('characterCount', { count: 7 }), '7 characters');
    assert.strictEqual(i18n.t('modeToggleAria', { label: 'Mode', current: 'inquiry', next: 'agent' }), 'Mode: currently inquiry; click to switch to agent');
    assert.strictEqual(i18n.t('testPositional', ['one', 'two', '', '', '', '', '', '', 'nine']), 'one / two / nine');
    assert.strictEqual(i18n.t('testDoubleBraces', { name: 'AskPage' }), 'AskPage');
    assert.strictEqual(i18n.resolveAutomaticLocale('en-US'), 'en');
    assert.strictEqual(i18n.resolveAutomaticLocale('zh-CN'), 'zh_CN');
    assert.strictEqual(i18n.resolveAutomaticLocale('zh-SG'), 'zh_CN');
    assert.strictEqual(i18n.resolveAutomaticLocale('zh-Hans-HK'), 'zh_CN');
    assert.strictEqual(i18n.resolveAutomaticLocale('zh-TW'), 'zh_TW');
    assert.strictEqual(i18n.resolveAutomaticLocale('zh-HK'), 'zh_TW');
    assert.strictEqual(i18n.resolveAutomaticLocale('zh-Hant-MO'), 'zh_TW');
    assert.strictEqual(i18n.resolveAutomaticLocale('ja-JP'), 'ja');
    assert.strictEqual(i18n.resolveAutomaticLocale('ko-KR'), 'ko');
    assert.strictEqual(i18n.resolveAutomaticLocale('fr-FR'), 'zh_TW');

    const root = new FakeElement('section');
    const marked = new FakeElement('span', root);
    marked.setAttribute('data-i18n', 'cancel');
    const placeholder = new FakeElement('input', root);
    placeholder.setAttribute('data-i18n-placeholder', 'commandNamePlaceholder');
    const title = new FakeElement('button', root);
    title.setAttribute('data-i18n-title', 'openPreferences');
    const untouched = new FakeElement('code', root);
    untouched.textContent = '取消';
    root.descendants = [marked, placeholder, title, untouched];
    i18n.observe(root);
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(marked.textContent, 'Cancel');
    assert.strictEqual(placeholder.getAttribute('placeholder'), 'For example: /help');
    assert.strictEqual(title.getAttribute('title'), 'Open preferences');
    assert.strictEqual(untouched.textContent, '取消');
    assert.strictEqual(root.getAttribute('lang'), 'en');
    assert.strictEqual(root.getAttribute('dir'), 'ltr');

    const shadowHost = new FakeElement('div');
    const shadowMarked = new FakeElement('span');
    shadowMarked.setAttribute('data-i18n', 'save');
    const shadowRoot = {
        nodeType: 11,
        host: shadowHost,
        descendants: [shadowMarked],
        querySelectorAll() {
            return this.descendants;
        }
    };
    i18n.observe(shadowRoot);
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(shadowMarked.textContent, 'Save');
    assert.strictEqual(shadowHost.getAttribute('lang'), 'en');
    assert.strictEqual(shadowHost.getAttribute('dir'), 'ltr');

    await i18n.setLocalePreference('ja');
    assert.strictEqual(i18n.locale, 'ja');
    assert.strictEqual(marked.textContent, 'キャンセル');
    assert.strictEqual(shadowMarked.textContent, '保存');
    assert.strictEqual(i18n.t('testFallback'), 'Fallback text');
    assert.strictEqual(root.getAttribute('lang'), 'ja');
    assert.strictEqual(storage.ASKPAGE_UI_LOCALE, 'ja');

    for (const locale of ['zh_TW', 'en', 'zh_CN', 'ja', 'ko']) {
        await i18n.setLocalePreference(locale);
        assert.strictEqual(i18n.getSystemPromptLanguageInstruction(), catalogs[locale].systemPromptLanguageInstruction.message);
    }

    storageChangedListener({ ASKPAGE_UI_LOCALE: { oldValue: 'ko', newValue: 'en' } }, 'local');
    await i18n.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(i18n.locale, 'en');
    assert.strictEqual(marked.textContent, 'Cancel');
    assert.strictEqual(shadowMarked.textContent, 'Save');

    const observer = FakeMutationObserver.instances.at(-1);
    const added = new FakeElement('span', root);
    added.setAttribute('data-i18n', 'save');
    observer.callback([{ type: 'childList', addedNodes: [added] }]);
    assert.strictEqual(added.textContent, 'Save');

    console.log('i18n-code-block: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
