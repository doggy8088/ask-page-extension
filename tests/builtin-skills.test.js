'use strict';

// 內建技能收斂後的行為：/clear 永遠存在、/summary 可停用、/screenshot 與 /agent 已移除；
// 停用的技能以 /名稱 執行時只提示、不送出。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const contentSource = read('src/content.js');
const locales = ['zh_TW', 'en', 'zh_CN', 'ja', 'ko'];
const catalogs = Object.fromEntries(locales.map((locale) => [locale, JSON.parse(read(`src/_locales/${locale}/messages.json`))]));
const zhTw = catalogs.zh_TW;

function section(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert(first >= 0 && last > first, `Missing source section: ${start}`);
    return source.slice(first, last);
}

function translate(key, substitutions) {
    const message = zhTw[key]?.message || key;
    return message.replace(/\$([A-Za-z][A-Za-z0-9_]*)\$/g, (match, name) => (
        substitutions && substitutions[name] !== undefined ? String(substitutions[name]) : match
    ));
}

let storageData = {};
const storageListeners = [];
const sandbox = {
    console: { log() {}, debug() {}, warn() {}, error() {}, info() {} },
    DOMPurify: { sanitize: (value) => value },
    AskPageI18n: { t: translate },
    chrome: {
        runtime: { getURL: (resource) => resource, onMessage: { addListener() {} }, sendMessage() {} },
        storage: {
            local: {
                async get(keys) {
                    const list = Array.isArray(keys) ? keys : [keys];
                    return Object.fromEntries(list.filter((key) => key in storageData).map((key) => [key, storageData[key]]));
                },
                async set() {}
            },
            onChanged: { addListener(listener) { storageListeners.push(listener); } }
        }
    },
    document: { addEventListener() {} },
    window: { location: { href: 'about:blank' } }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('src/lib/skill-schema.js'), sandbox, { filename: 'lib/skill-schema.js' });
vm.runInContext(contentSource, sandbox, { filename: 'content.js' });

// createDialog 內部函式與其相依的 UI 狀態，以最小替身提供。
const messages = [];
const askCalls = [];
const modeCalls = [];
Object.assign(sandbox, {
    getTemplateBuiltinValues: () => ({ SELECTED_TEXT: '' }),
    templateRequiresMissingSelectedText: () => false,
    rejectForMissingSelectedText: () => { throw new Error('unexpected missing selection'); },
    input: { value: '', focus() {} },
    snippetState: null,
    inputContextImageDataUrls: [],
    capturedSelectedText: '',
    promptHistory: [],
    historyIndex: 0,
    messagesEl: { innerHTML: '' },
    hideIntelliBox() {},
    finalizeSnippetInput() {},
    clearInputContextImages() {},
    setInputValue(value) { sandbox.input.value = value; },
    appendMessage(role, text) { messages.push({ role, text }); },
    appendErrorMessageAndStore(text) { messages.push({ role: 'error', text }); },
    appendUsagePromptMessage: async () => {},
    hasPendingAnnotatedScreenshotContext: () => false,
    applyCustomCommandExecutionMode: async (command) => { modeCalls.push(command); },
    askAI: async (question) => { askCalls.push(question); },
    beginAskTask: () => ({ id: 1, signal: null }),
    finishAskTask() {},
    canUpdateAskTaskUi: () => true
});
vm.runInContext(`${section(contentSource, '    function rejectDisabledSkill(', '    // 沒有選取文字時')}
${section(contentSource, '    function getUserInvocableSkills() {', '    const intelliBox = document.createElement')}
${section(contentSource, '    function createInlineSlashCommandMarkup(', '    async function triggerInlineSlashCommand(')}
${section(contentSource, '    async function handleAsk() {', '    async function showIntelliBox(')}
globalThis.__builtin = {
    getIntelliCommands,
    buildUsageCommandsHtml,
    buildPromptCommandListCopyText,
    buildCustomCommandListCopyText,
    handleAsk
};`, sandbox, { filename: 'content.js#dialog' });
const api = sandbox.__builtin;

const skillRecords = [
    { name: 'translate', command: '/翻譯', description: 'Translate text', instructions: 'Translate it', invocation: 'auto' },
    { name: 'secret', command: '/secret', description: 'Secret', instructions: 'TOP SECRET BODY', invocation: 'explicit', askpage: { mode: 'agent', screenshotEnabled: true } },
    { name: 'paused', command: '/paused', description: 'Paused', instructions: 'PAUSED BODY', invocation: 'auto', enabled: false }
];

async function setStorage(data) {
    storageData = data;
    storageListeners.forEach((listener) => listener({ ASKPAGE_SKILLS: {}, CUSTOM_SUMMARY_ENABLED: {} }, 'local'));
    await sandbox.ensureSkillsRuntime();
}

async function ask(question) {
    messages.length = 0;
    askCalls.length = 0;
    modeCalls.length = 0;
    sandbox.input.value = question;
    await api.handleAsk();
}

(async () => {
    // ---------- / 自動完成 ----------
    await setStorage({ ASKPAGE_SKILLS: skillRecords });
    let commands = [...(await api.getIntelliCommands()).map((command) => command.cmd)];
    assert.deepStrictEqual(commands, ['/clear', '/summary', '/翻譯', '/secret'], '停用技能不進自動完成');
    assert.ok(!commands.includes('/screenshot') && !commands.includes('/agent'), '/screenshot、/agent 已移除');
    const translateItem = (await api.getIntelliCommands()).find((command) => command.cmd === '/翻譯');
    assert.strictEqual(translateItem.desc, 'Translate text', '描述使用 description');
    assert.strictEqual(translateItem.template, 'Translate it');

    await setStorage({ ASKPAGE_SKILLS: skillRecords, CUSTOM_SUMMARY_ENABLED: false });
    commands = [...(await api.getIntelliCommands()).map((command) => command.cmd)];
    assert.deepStrictEqual(commands, ['/clear', '/翻譯', '/secret'], '/summary 停用後不進自動完成');

    // ---------- 使用說明與複製文字 ----------
    const enabledHtml = api.buildUsageCommandsHtml([], { summaryEnabled: true });
    assert.ok(enabledHtml.includes('data-askpage-command="/clear"'));
    assert.ok(enabledHtml.includes('data-askpage-command="/summary"'));
    const disabledHtml = api.buildUsageCommandsHtml([], { summaryEnabled: false });
    assert.ok(disabledHtml.includes('data-askpage-command="/clear"'));
    assert.ok(!disabledHtml.includes('/summary'));
    for (const html of [enabledHtml, disabledHtml]) {
        assert.ok(!html.includes('/screenshot') && !html.includes('/agent'));
    }

    const enabledCopy = api.buildPromptCommandListCopyText({ summaryEnabled: true });
    assert.strictEqual(enabledCopy, '**內建技能：**\n- /clear - 清除歷史紀錄（Ctrl+L）\n- /summary - 總結本頁內容');
    const disabledCopy = api.buildPromptCommandListCopyText({ summaryEnabled: false });
    assert.strictEqual(disabledCopy, '**內建技能：**\n- /clear - 清除歷史紀錄（Ctrl+L）');

    const customCopy = api.buildCustomCommandListCopyText([{ cmd: '/翻譯', desc: 'Translate text' }]);
    assert.match(customCopy, /- \/翻譯 - Translate text/);
    const customHtml = api.buildUsageCommandsHtml([{ cmd: '/翻譯', desc: 'Translate text' }], { summaryEnabled: true });
    assert.ok(customHtml.includes('data-askpage-command="/翻譯"'));

    // ---------- 執行：/summary 停用 ----------
    await ask('/summary');
    assert.strictEqual(askCalls.length, 0, '/summary 停用時不送出');
    assert.deepStrictEqual(messages.map((message) => message.role), ['user', 'assistant']);
    assert.strictEqual(messages[1].text, translate('skillDisabled', { skill: '/summary' }));

    // ---------- 執行：/summary 啟用 ----------
    await setStorage({ ASKPAGE_SKILLS: skillRecords });
    await ask('/summary');
    assert.deepStrictEqual(askCalls, [zhTw.summaryPrompt.message]);

    // ---------- 執行：停用的使用者技能 ----------
    await ask('/paused');
    assert.strictEqual(askCalls.length, 0, '停用技能不送出');
    assert.strictEqual(messages[1].text, translate('skillDisabled', { skill: '/paused' }));
    assert.ok(!JSON.stringify(messages).includes('PAUSED BODY'));

    // ---------- 執行：明確技能 ----------
    await ask('/secret');
    assert.deepStrictEqual(askCalls, ['TOP SECRET BODY'], '明確技能以本文取代輸入');
    assert.strictEqual(modeCalls.length, 1);
    assert.strictEqual(modeCalls[0].mode, 'agent');
    assert.strictEqual(modeCalls[0].screenshotEnabled, true);

    // ---------- 執行：不帶 / 的技能名稱是一般提問，不觸發技能 ----------
    for (const question of ['secret', 'paused', '翻譯']) {
        await ask(question);
        assert.deepStrictEqual(askCalls, [question], `${question} 當一般提示詞送出`);
        assert.strictEqual(modeCalls.length, 0);
        assert.ok(!messages.some((message) => message.text === translate('skillDisabled', { skill: question })), '不顯示技能已停用');
    }

    // ---------- 執行：已移除的 /screenshot、/agent 與未命中的 /字串 ----------
    for (const question of ['/agent', '/screenshot', '/unknown']) {
        await ask(question);
        assert.deepStrictEqual(askCalls, [question], `${question} 當一般提示詞送出`);
        assert.strictEqual(modeCalls.length, 0);
    }

    // ---------- 語系 ----------
    const removedKeys = ['builtInCommandCopyText', 'commandScreenshot', 'commandAgent', 'enableScreenshot', 'disableScreenshot', 'switchToInquiryMode', 'switchToAgentMode'];
    for (const locale of locales) {
        for (const key of removedKeys) {
            assert.ok(!(key in catalogs[locale]), `${locale} 不應保留孤兒 key ${key}`);
        }
        for (const key of ['skillDisabled', 'builtInSkillsCopyHeading']) {
            assert.ok(catalogs[locale][key]?.message, `${locale} 缺少 ${key}`);
        }
    }
    for (const key of removedKeys) {
        assert.ok(!contentSource.includes(`'${key}'`), `content.js 不應再使用 ${key}`);
        assert.ok(!read('src/settings.js').includes(`'${key}'`), `settings.js 不應再使用 ${key}`);
    }

    console.log('builtin-skills: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
