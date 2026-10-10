'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const styleSheet = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
const zhTwCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, '_locales', 'zh_TW', 'messages.json'), 'utf8'));

function sliceSource(startMarker, endMarker) {
    const start = contentScript.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `找不到 ${startMarker}`);
    const end = contentScript.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, `找不到 ${endMarker}`);
    return contentScript.slice(start, end);
}

// 1. 驗證不再拼接「你: 」前綴，且具備 hover 圖示與原位編輯樣式
assert.doesNotMatch(
    contentScript,
    /userMessagePrefix/,
    '用戶提問訊息不可再附加 userMessagePrefix（你: ）前綴'
);
assert.match(styleSheet, /#gemini-qna-messages \.gemini-msg-user \.askpage-user-msg-actions \{/);
assert.match(styleSheet, /#gemini-qna-messages \.gemini-msg-user:not\(\.is-editing\):hover \.askpage-user-msg-actions/);
assert.match(styleSheet, /#gemini-qna-messages \.gemini-msg-user \.askpage-user-msg-action-btn\[data-tooltip\]::after/);
assert.match(styleSheet, /#gemini-qna-messages \.gemini-msg-user\.is-editing \{/);

// 2. 以真實 DOM 模擬與 VM 執行驗證複製、原位展開編輯、取消、送出截斷後續對話並重問
class FakeClassList {
    constructor(element) {
        this.element = element;
        this.classes = new Set();
    }

    _sync() {
        this.element._className = Array.from(this.classes).join(' ');
    }

    setFromString(value) {
        this.classes = new Set(String(value || '').split(/\s+/).filter(Boolean));
        this._sync();
    }

    add(...names) {
        names.forEach((name) => {
            if (name) {
                this.classes.add(name);
            }
        });
        this._sync();
    }

    remove(...names) {
        names.forEach((name) => this.classes.delete(name));
        this._sync();
    }

    toggle(name, force) {
        const shouldHave = force === undefined ? !this.classes.has(name) : Boolean(force);
        if (shouldHave) {
            this.classes.add(name);
        } else {
            this.classes.delete(name);
        }
        this._sync();
        return shouldHave;
    }

    contains(name) {
        return this.classes.has(name);
    }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName || 'div').toUpperCase();
        this._className = '';
        this.classList = new FakeClassList(this);
        this.dataset = Object.create(null);
        this.attributes = new Map();
        this.style = {};
        this.children = [];
        this.parentNode = null;
        this.listeners = new Map();
        this._textContent = '';
        this._innerHTML = '';
        this.value = '';
        this.disabled = false;
        this.focused = false;
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.scrollHeight = 44;
    }

    get className() {
        return this._className;
    }

    set className(value) {
        this.classList.setFromString(value);
    }

    get textContent() {
        if (this.children.length > 0) {
            return (this._textContent || '') + this.children.map((child) => child.textContent).join('');
        }
        return this._textContent;
    }

    set textContent(value) {
        this.children.forEach((child) => {
            child.parentNode = null;
        });
        this.children = [];
        this._innerHTML = '';
        this._textContent = String(value ?? '');
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(value) {
        this.children.forEach((child) => {
            child.parentNode = null;
        });
        this.children = [];
        this._textContent = '';
        this._innerHTML = String(value ?? '');
    }

    appendChild(child) {
        if (child.parentNode) {
            child.remove();
        }
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (!this.parentNode) {
            return;
        }
        const idx = this.parentNode.children.indexOf(this);
        if (idx !== -1) {
            this.parentNode.children.splice(idx, 1);
        }
        this.parentNode = null;
    }

    get nextSibling() {
        if (!this.parentNode) {
            return null;
        }
        const idx = this.parentNode.children.indexOf(this);
        return idx !== -1 && idx + 1 < this.parentNode.children.length
            ? this.parentNode.children[idx + 1]
            : null;
    }

    get nextElementSibling() {
        return this.nextSibling;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    addEventListener(type, handler) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(handler);
    }

    dispatchEvent(event) {
        const handlers = this.listeners.get(event.type) || [];
        for (const handler of handlers) {
            handler(event);
        }
    }

    click() {
        this.dispatchEvent({
            type: 'click',
            preventDefault() {},
            stopPropagation() {}
        });
    }

    focus() {
        this.focused = true;
    }

    setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
    }

    matches(selector) {
        const parts = selector.split('.').filter(Boolean);
        return parts.every((cls) => this.classList.contains(cls));
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const results = [];
        const visit = (node) => {
            node.children.forEach((child) => {
                if (child.matches(selector)) {
                    results.push(child);
                }
                visit(child);
            });
        };
        visit(this);
        return results;
    }
}

const messagesEl = new FakeElement('div');
const clipboardHistory = [];
const askAICalls = [];
const storageWrites = [];
const promptHistory = [];
let historyIndex = 0;
let capturedSelectedText = '選取文字';

const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    conversationHistory: [],
    activeAskTask: null,
    askTaskSequence: 0,
    ASK_TASK_CANCELLED_ERROR_NAME: 'AbortError',
    ASK_TASK_STOP_BUTTON_CLASS: 'askpage-submit-stop',
    PROMPT_HISTORY_STORAGE: 'ASKPAGE_PROMPT_HISTORY',
    promptHistory,
    historyIndex,
    capturedSelectedText,
    messagesEl,
    document: {
        createElement(tag) {
            return new FakeElement(tag);
        }
    },
    navigator: {
        clipboard: {
            async writeText(text) {
                clipboardHistory.push(text);
            }
        }
    },
    getLocalizedText(key, substitutions = {}) {
        const message = zhTwCatalog[key]?.message || key;
        return message.replace(/\$([A-Za-z][A-Za-z0-9_]*)\$/g, (match, name) => substitutions[name] ?? match);
    },
    normalizeInputImageDataUrls(urls) {
        return Array.isArray(urls) ? urls.filter(Boolean) : [];
    },
    isImageDataUrl(url) {
        return typeof url === 'string' && url.startsWith('data:image/');
    },
    setImageDataUrlSource(img, url) {
        img.src = url;
    },
    shouldCollapseTextPreview() {
        return false;
    },
    getAssistantStoredText(text) {
        return String(text ?? '');
    },
    renderAssistantMessageElement(el, text) {
        el.textContent = text;
    },
    appendNodeToActiveMessages(node, container) {
        container.appendChild(node);
        return node;
    },
    getActiveMessagesElement(fallback) {
        return fallback;
    },
    getActiveDialogHost() {
        return {};
    },
    getActiveDialogElementById() {
        return null;
    },
    resumeActiveMessagesAutoScroll() {},
    getActiveSelectedText(text) {
        return text;
    },
    async setValue(key, val) {
        storageWrites.push({ key, val });
    },
    async askAI(question, selectedText, screenshotDataUrl, inputImageDataUrls, task) {
        askAICalls.push({ question, selectedText, screenshotDataUrl, inputImageDataUrls, task });
        sandbox.appendPersistentMessage('assistant', `AI 針對「${question}」的回答`);
    }
};

vm.createContext(sandbox);
vm.runInContext(`
${sliceSource('function createAskTaskCancellationError()', 'function doesGeminiModelSupportCombinedTools(')}
${sliceSource('function appendCollapsibleTextPreview(', 'function enhanceCodeBlocks(')}
${sliceSource('function addConversationTurn(', 'function clearConversationHistory()')}
${sliceSource('    function appendUserScreenshotThumbnail(', '    function appendAgentTraceMessage(')}
this.addConversationTurn = addConversationTurn;
this.truncateConversationFromTurn = truncateConversationFromTurn;
this.appendMessage = appendMessage;
this.appendPersistentMessage = appendPersistentMessage;
`, sandbox);

(async () => {
    const { addConversationTurn, appendMessage, appendPersistentMessage, conversationHistory } = sandbox;

    // 建立第一輪與第二輪對話
    const firstQuestion = '請幫我總結這篇文章，並以 Markdown 格式輸出';
    const turn1 = addConversationTurn('user', firstQuestion, firstQuestion, {
        screenshotDataUrl: 'data:image/png;base64,AAA',
        inputImageDataUrls: ['data:image/png;base64,BBB']
    });
    const userEl1 = appendMessage('user', firstQuestion, {
        turn: turn1,
        screenshotDataUrl: turn1.screenshotDataUrl,
        inputImageDataUrls: turn1.inputImageDataUrls
    });
    appendPersistentMessage('assistant', '第一輪 AI 回答');

    const secondQuestion = '第二個問題';
    const turn2 = addConversationTurn('user', secondQuestion, secondQuestion);
    appendMessage('user', secondQuestion, { turn: turn2 });
    appendPersistentMessage('assistant', '第二輪 AI 回答');

    assert.strictEqual(messagesEl.children.length, 4);
    assert.strictEqual(conversationHistory.length, 4);

    // 驗證用戶訊息不帶「你: 」前綴，且包含複製與編輯按鈕
    assert.strictEqual(userEl1._textContent, firstQuestion);
    assert.ok(!userEl1.textContent.startsWith('你:'), '不應有「你:」前綴');

    const copyBtn = userEl1.querySelector('.askpage-user-copy-btn');
    const editBtn = userEl1.querySelector('.askpage-user-edit-btn');
    assert.ok(copyBtn, '應有複製按鈕');
    assert.ok(editBtn, '應有編輯按鈕');
    assert.strictEqual(copyBtn.dataset.tooltip, '複製訊息');
    assert.strictEqual(editBtn.dataset.tooltip, '編輯訊息');

    // 測試點擊複製按鈕
    copyBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepStrictEqual(clipboardHistory, [firstQuestion]);
    assert.strictEqual(copyBtn.dataset.state, 'copied');
    assert.strictEqual(copyBtn.dataset.tooltip, '已複製');
    if (copyBtn._copyResetTimer) {
        clearTimeout(copyBtn._copyResetTimer);
    }

    // 測試點擊編輯按鈕 -> 展開原位編輯框，再點取消 -> 還原原訊息且不影響後續對話
    editBtn.click();
    assert.strictEqual(userEl1.classList.contains('is-editing'), true);
    const textarea1 = userEl1.querySelector('.askpage-user-edit-textarea');
    const cancelBtn1 = userEl1.querySelector('.askpage-user-edit-cancel-btn');
    assert.ok(textarea1, '應顯示原位編輯 textarea');
    assert.strictEqual(textarea1.value, firstQuestion);
    assert.strictEqual(textarea1.focused, true);

    textarea1.value = '修改但取消的文字';
    cancelBtn1.click();
    assert.strictEqual(userEl1.classList.contains('is-editing'), false);
    assert.strictEqual(userEl1._textContent, firstQuestion, '取消後應還原原本文字');
    assert.strictEqual(messagesEl.children.length, 4, '取消編輯不應移除後續對話');
    assert.strictEqual(conversationHistory.length, 4);

    // 測試再次點擊編輯並修改送出 -> 截斷後續對話並重新觸發 askAI
    const editBtnAgain = userEl1.querySelector('.askpage-user-edit-btn');
    editBtnAgain.click();
    const textarea2 = userEl1.querySelector('.askpage-user-edit-textarea');
    const submitBtn2 = userEl1.querySelector('.askpage-user-edit-submit-btn');
    const editedQuestion = '請改用條列式重點整理這篇文章';
    textarea2.value = editedQuestion;
    textarea2.dispatchEvent({ type: 'input' });
    assert.strictEqual(submitBtn2.disabled, false);

    submitBtn2.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(userEl1.classList.contains('is-editing'), false);
    assert.strictEqual(userEl1._textContent, editedQuestion, '送出後訊息文字應更新為編輯後內容');
    assert.ok(userEl1.querySelector('.askpage-message-screenshot-thumb'), '編輯後仍保留原本附帶的截圖縮圖');
    assert.ok(userEl1.querySelector('.askpage-user-context-image-thumb'), '編輯後仍保留原本附帶的圖片上下文');
    assert.strictEqual(askAICalls.length, 1, '送出編輯後應重新呼叫 askAI');
    assert.strictEqual(askAICalls[0].question, editedQuestion);
    assert.strictEqual(askAICalls[0].screenshotDataUrl, 'data:image/png;base64,AAA');
    assert.deepStrictEqual(askAICalls[0].inputImageDataUrls, ['data:image/png;base64,BBB']);

    // 後續原本的訊息與歷史應被截斷，只剩下修改後的第一題與新產生的回答
    assert.strictEqual(conversationHistory.length, 2);
    assert.strictEqual(conversationHistory[0].role, 'user');
    assert.strictEqual(conversationHistory[0].content, editedQuestion);
    assert.strictEqual(conversationHistory[1].role, 'assistant');
    assert.strictEqual(conversationHistory[1].content, `AI 針對「${editedQuestion}」的回答`);
    assert.strictEqual(messagesEl.children.length, 2);

    console.log('user-message-actions: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
