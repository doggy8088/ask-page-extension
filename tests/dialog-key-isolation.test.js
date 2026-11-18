'use strict';

// dialog-key-isolation.js 必須在 document_start 搶先註冊 window capture listener，
// 把來自對話框的鍵盤與剪貼簿事件擋在宿主頁面之前，再轉送給對話框內的焦點元素。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(rootDir, 'src', 'lib', 'dialog-key-isolation.js'), 'utf8');

class FakeKeyboardEvent {
    constructor(type, init = {}) {
        Object.assign(this, init);
        this.type = type;
        this.isTrusted = false;
        this.defaultPrevented = false;
        this.immediatePropagationStopped = false;
    }

    preventDefault() {
        this.defaultPrevented = true;
    }

    stopImmediatePropagation() {
        this.immediatePropagationStopped = true;
    }
}

class FakeEvent extends FakeKeyboardEvent {}

class FakeClipboardEvent extends FakeKeyboardEvent {
    constructor(type, init = {}) {
        const { clipboardData, ...rest } = init;
        super(type, rest);
        this.clipboardData = clipboardData || null;
    }
}

function createTrustedEvent(type, init) {
    const event = new FakeKeyboardEvent(type, init);
    event.isTrusted = true;
    return event;
}

function createTarget(onEvent = () => {}) {
    const received = [];
    return {
        received,
        dispatchEvent(event) {
            received.push(event);
            onEvent(event);
            return !event.defaultPrevented;
        }
    };
}

function loadIsolation({ ClipboardEvent = FakeClipboardEvent } = {}) {
    const listeners = [];
    const sandbox = {
        KeyboardEvent: FakeKeyboardEvent,
        ClipboardEvent,
        Event: FakeEvent,
        window: {
            addEventListener(type, listener, capture) {
                listeners.push({ type, listener, capture });
            }
        }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'lib/dialog-key-isolation.js' });

    // 模擬 window 上依註冊順序執行的 listener：本檔先註冊，頁面的快捷鍵在後。
    const pageReceived = [];
    function dispatchOnWindow(event) {
        for (const entry of listeners.filter((item) => item.type === event.type)) {
            entry.listener(event);
            if (event.immediatePropagationStopped) {
                return;
            }
        }
        pageReceived.push(event);
    }

    return { sandbox, listeners, pageReceived, dispatchOnWindow };
}

// 在 window capture 階段註冊 keydown、keypress、keyup 與 paste、copy、cut。
{
    const { sandbox, listeners } = loadIsolation();
    assert.deepStrictEqual(listeners.map((item) => [item.type, item.capture]), [
        ['keydown', true],
        ['keypress', true],
        ['keyup', true],
        ['paste', true],
        ['copy', true],
        ['cut', true]
    ]);
    assert.strictEqual(typeof sandbox.AskPageDialogKeyIsolation.setTargetResolver, 'function');
}

// 沒有開啟對話框時，事件照常送到頁面。
{
    const { pageReceived, dispatchOnWindow } = loadIsolation();
    const event = createTrustedEvent('keydown', { key: '/' });
    dispatchOnWindow(event);
    assert.strictEqual(pageReceived.length, 1);
    assert.strictEqual(event.immediatePropagationStopped, false);
}

// 來自對話框的事件：頁面收不到，焦點元素收到 composed: false 的複製事件。
{
    const { sandbox, pageReceived, dispatchOnWindow } = loadIsolation();
    const host = {};
    const input = createTarget();
    sandbox.AskPageDialogKeyIsolation.setTargetResolver((event) => (event.target === host ? input : null));

    const event = createTrustedEvent('keydown', {
        target: host,
        key: '/',
        code: 'Slash',
        keyCode: 191,
        shiftKey: false,
        isComposing: false
    });
    dispatchOnWindow(event);

    assert.strictEqual(pageReceived.length, 0, '頁面不應收到對話框的鍵盤事件');
    assert.strictEqual(input.received.length, 1);
    const clone = input.received[0];
    assert.strictEqual(clone.type, 'keydown');
    assert.strictEqual(clone.key, '/');
    assert.strictEqual(clone.code, 'Slash');
    assert.strictEqual(clone.keyCode, 191);
    assert.strictEqual(clone.composed, false, '複製事件不可離開 shadow root');
    assert.strictEqual(clone.bubbles, true);
    assert.strictEqual(clone.cancelable, true);
    assert.strictEqual(event.defaultPrevented, false, '未被取消時應保留原事件的預設輸入行為');
}

// 對話框處理器取消複製事件時，同步取消原事件的預設行為（例如 Enter 送出不換行）。
{
    const { sandbox, dispatchOnWindow } = loadIsolation();
    const host = {};
    const input = createTarget((clone) => {
        if (clone.key === 'Enter') {
            clone.preventDefault();
        }
    });
    sandbox.AskPageDialogKeyIsolation.setTargetResolver((event) => (event.target === host ? input : null));

    const event = createTrustedEvent('keydown', { target: host, key: 'Enter' });
    dispatchOnWindow(event);
    assert.strictEqual(event.defaultPrevented, true);
}

// 非 trusted 事件與焦點不在對話框的事件不攔截；清除 resolver 後恢復原本流程。
{
    const { sandbox, pageReceived, dispatchOnWindow } = loadIsolation();
    const host = {};
    const input = createTarget();
    const resolver = (event) => (event.target === host ? input : null);
    sandbox.AskPageDialogKeyIsolation.setTargetResolver(resolver);

    const synthetic = new FakeKeyboardEvent('keydown', { target: host, key: 'a' });
    dispatchOnWindow(synthetic);
    dispatchOnWindow(createTrustedEvent('keydown', { target: {}, key: 'a' }));
    assert.strictEqual(pageReceived.length, 2);
    assert.strictEqual(input.received.length, 0);

    sandbox.AskPageDialogKeyIsolation.clearTargetResolver(() => input);
    dispatchOnWindow(createTrustedEvent('keyup', { target: host, key: 'a' }));
    assert.strictEqual(input.received.length, 1, '只有同一個 resolver 才能清除');

    sandbox.AskPageDialogKeyIsolation.clearTargetResolver(resolver);
    dispatchOnWindow(createTrustedEvent('keyup', { target: host, key: 'a' }));
    assert.strictEqual(pageReceived.length, 3);
    assert.strictEqual(input.received.length, 1);
}

// 在對話框內貼上：頁面的全域 paste 處理器收不到，焦點元素收到共用同一個 clipboardData 的複製事件；
// 對話框沒有取消時保留原事件的預設貼上行為，文字照常貼進對話框的輸入框。
{
    const { sandbox, pageReceived, dispatchOnWindow } = loadIsolation();
    const host = {};
    const input = createTarget();
    sandbox.AskPageDialogKeyIsolation.setTargetResolver((event) => (event.target === host ? input : null));

    const clipboardData = { getData: () => '剪貼簿內容' };
    const event = createTrustedEvent('paste', { target: host, clipboardData });
    dispatchOnWindow(event);

    assert.strictEqual(pageReceived.length, 0, '頁面不應收到對話框的 paste 事件');
    assert.strictEqual(input.received.length, 1);
    const clone = input.received[0];
    assert.ok(clone instanceof FakeClipboardEvent);
    assert.strictEqual(clone.type, 'paste');
    assert.strictEqual(clone.clipboardData, clipboardData, '複製事件要能讀到同一份剪貼簿資料');
    assert.strictEqual(clone.composed, false, '複製事件不可離開 shadow root');
    assert.strictEqual(clone.bubbles, true);
    assert.strictEqual(clone.cancelable, true);
    assert.strictEqual(event.defaultPrevented, false, '未被取消時應保留原事件的預設貼上行為');
}

// 對話框處理器取消複製事件（例如貼上圖片）時，同步取消原事件；copy、cut 也一併攔截。
{
    const { sandbox, pageReceived, dispatchOnWindow } = loadIsolation();
    const host = {};
    const input = createTarget((clone) => {
        if (clone.type === 'paste') {
            clone.preventDefault();
        }
    });
    sandbox.AskPageDialogKeyIsolation.setTargetResolver((event) => (event.target === host ? input : null));

    const paste = createTrustedEvent('paste', { target: host, clipboardData: {} });
    dispatchOnWindow(paste);
    assert.strictEqual(paste.defaultPrevented, true);

    const copy = createTrustedEvent('copy', { target: host, clipboardData: {} });
    const cut = createTrustedEvent('cut', { target: host, clipboardData: {} });
    dispatchOnWindow(copy);
    dispatchOnWindow(cut);
    assert.strictEqual(pageReceived.length, 0);
    assert.deepStrictEqual(input.received.map((clone) => clone.type), ['paste', 'copy', 'cut']);
    assert.strictEqual(copy.defaultPrevented, false, '未被取消時保留原本的複製行為');
    assert.strictEqual(cut.defaultPrevented, false, '未被取消時保留原本的剪下行為');

    // 焦點不在對話框時，頁面照常收到剪貼簿事件。
    dispatchOnWindow(createTrustedEvent('paste', { target: {}, clipboardData: {} }));
    assert.strictEqual(pageReceived.length, 1);
}

// 不支援以 clipboardData 建立 ClipboardEvent 的瀏覽器：改用一般 Event 並掛上原本的 clipboardData。
{
    class ThrowingClipboardEvent {
        constructor() {
            throw new TypeError('Illegal constructor');
        }
    }
    const { sandbox, dispatchOnWindow } = loadIsolation({ ClipboardEvent: ThrowingClipboardEvent });
    const host = {};
    const input = createTarget();
    sandbox.AskPageDialogKeyIsolation.setTargetResolver((event) => (event.target === host ? input : null));

    const clipboardData = {};
    dispatchOnWindow(createTrustedEvent('paste', { target: host, clipboardData }));
    assert.strictEqual(input.received.length, 1);
    assert.ok(input.received[0] instanceof FakeEvent);
    assert.strictEqual(input.received[0].clipboardData, clipboardData);
    assert.strictEqual(input.received[0].composed, false);
}

// 重複注入時不重複註冊 listener。
{
    const { sandbox, listeners } = loadIsolation();
    vm.runInContext(source, sandbox, { filename: 'lib/dialog-key-isolation.js' });
    assert.strictEqual(listeners.length, 6);
}

// content.js 的 resolver：沒有焦點元素時（例如只選取回覆文字後按 Cmd+C）改送到 overlay。
{
    const contentSource = fs.readFileSync(path.join(rootDir, 'src', 'content.js'), 'utf8');
    assert.match(contentSource, /const resolveDialogKeyTarget = \(event\) => \{[\s\S]*?return shadowRoot\.activeElement \|\| overlay;/);
}

console.log('dialog-key-isolation tests passed');
