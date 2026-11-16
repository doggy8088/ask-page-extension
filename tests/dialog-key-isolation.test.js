'use strict';

// dialog-key-isolation.js 必須在 document_start 搶先註冊 window capture listener，
// 把來自對話框的鍵盤事件擋在宿主頁面之前，再轉送給對話框內的焦點元素。

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

function loadIsolation() {
    const listeners = [];
    const sandbox = {
        KeyboardEvent: FakeKeyboardEvent,
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

// 在 window capture 階段註冊 keydown、keypress、keyup。
{
    const { sandbox, listeners } = loadIsolation();
    assert.deepStrictEqual(listeners.map((item) => [item.type, item.capture]), [
        ['keydown', true],
        ['keypress', true],
        ['keyup', true]
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

// 重複注入時不重複註冊 listener。
{
    const { sandbox, listeners } = loadIsolation();
    vm.runInContext(source, sandbox, { filename: 'lib/dialog-key-isolation.js' });
    assert.strictEqual(listeners.length, 3);
}

console.log('dialog-key-isolation tests passed');
