'use strict';

// content script 的所有檔案會被注入同一個 JavaScript 全域作用域，
// 因此任何兩個檔案重複宣告頂層 const／let／class 都會讓整個內容腳本載入失敗。
// Node 測試用 require() 各自載入模組，抓不到這種衝突，因此需要單獨驗證。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const contentScriptFiles = manifest.content_scripts
    .filter((entry) => !entry.world || entry.world === 'ISOLATED')
    .flatMap((entry) => entry.js);

const {
    createElement,
    createDocument
} = require('./helpers/mock-dom');

const body = createElement('body');
const documentRef = createDocument(body, '內容腳本作用域測試頁');

// 依 Chrome 的行為，把每個內容腳本依序載入同一個作用域。
// 只要有重複的頂層 const／let／class，就會在載入該檔案時拋出 SyntaxError。
const sandbox = {
    console: { log() {}, warn() {}, error() {}, debug() {}, info() {} },
    marked: {},
    DOMPurify: { sanitize(value) { return value; } },
    WeakRef,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame(callback) { return setTimeout(callback, 0); },
    cancelAnimationFrame(handle) { clearTimeout(handle); },
    chrome: {
        runtime: {
            getURL(resourcePath) { return resourcePath; },
            getManifest() { return { version: manifest.version }; },
            onMessage: { addListener() {} },
            sendMessage() {}
        },
        storage: {
            local: {
                async get() { return {}; },
                async set() {}
            },
            onChanged: { addListener() {} }
        },
        userScripts: {
            async execute() { return []; }
        }
    },
    document: documentRef,
    window: {
        location: documentRef.location,
        innerWidth: 1280,
        innerHeight: 800,
        getComputedStyle(element) { return element.styleState; },
        addEventListener() {},
        removeEventListener() {},
        matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; }
    },
    globalThis: null
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const file of contentScriptFiles) {
    const source = fs.readFileSync(path.join(rootDir, file), 'utf8');
    assert.doesNotThrow(
        () => vm.runInContext(source, sandbox, { filename: file }),
        `${file} 載入到共用作用域時不應拋出錯誤`
    );
}

// 載入完成後，各個 lib 模組都應掛到 globalThis 上。
assert.ok(sandbox.AskPageToolPolicy, 'tool-policy 模組應掛到全域');
assert.ok(sandbox.AskPageToolGovernance, 'tool-governance 模組應掛到全域');
assert.ok(sandbox.AskPageAnthropicTools, 'anthropic-tools 模組應掛到全域');

console.log('content-script-scope: ok');
