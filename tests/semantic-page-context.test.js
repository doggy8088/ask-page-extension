'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');

function createTextNode(text) {
    return {
        nodeType: 3,
        textContent: text,
        parentElement: null
    };
}

function createElement(tagName, attributes = {}, children = []) {
    const normalizedAttributes = Object.fromEntries(
        Object.entries(attributes).map(([name, value]) => [name, String(value)])
    );
    const element = {
        nodeType: 1,
        tagName: tagName.toUpperCase(),
        childNodes: [],
        parentElement: null,
        ownerDocument: null,
        hidden: false,
        isContentEditable: false,
        labels: [],
        value: '',
        type: normalizedAttributes.type || '',
        id: normalizedAttributes.id || '',
        styleState: {
            display: 'block',
            visibility: 'visible'
        },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(normalizedAttributes, name)
                ? normalizedAttributes[name]
                : null;
        },
        hasAttribute(name) {
            return Object.prototype.hasOwnProperty.call(normalizedAttributes, name);
        }
    };

    Object.defineProperty(element, 'textContent', {
        get() {
            return element.childNodes.map((child) => child.textContent || '').join('');
        }
    });
    Object.defineProperty(element, 'innerText', {
        get() {
            return element.textContent;
        }
    });

    children.forEach((child) => appendChild(element, child));
    return element;
}

function appendChild(parent, child) {
    parent.childNodes.push(child);
    child.parentElement = parent.nodeType === 1 ? parent : null;
    if (parent.ownerDocument) {
        assignDocument(child, parent.ownerDocument);
    }
    return child;
}

function assignDocument(node, documentRef) {
    if (!node || typeof node !== 'object') {
        return;
    }
    node.ownerDocument = documentRef;
    (node.childNodes || []).forEach((child) => assignDocument(child, documentRef));
    (node.shadowRoot?.childNodes || []).forEach((child) => assignDocument(child, documentRef));
}

function createDocument(body, title = '測試頁面') {
    const documentRef = {
        title,
        body,
        location: { href: 'https://example.com/page' },
        getElementById(id) {
            return findElement(body, (element) => element.id === id);
        },
        getElementsByTagName(tagName) {
            const matches = [];
            walkElements(body, (element) => {
                if (element.tagName === tagName.toUpperCase()) {
                    matches.push(element);
                }
            });
            return matches;
        },
        querySelector(selector) {
            if (selector === 'main') {
                return findElement(body, (element) => element.tagName === 'MAIN');
            }
            return null;
        },
        querySelectorAll(selector) {
            if (selector === 'article') {
                const articles = [];
                walkElements(body, (element) => {
                    if (element.tagName === 'ARTICLE') {
                        articles.push(element);
                    }
                });
                return articles;
            }
            return [];
        }
    };
    assignDocument(body, documentRef);
    return documentRef;
}

function walkElements(node, callback) {
    if (!node) {
        return;
    }
    if (node.nodeType === 1) {
        callback(node);
    }
    (node.childNodes || []).forEach((child) => walkElements(child, callback));
    (node.shadowRoot?.childNodes || []).forEach((child) => walkElements(child, callback));
}

function findElement(root, predicate) {
    let match = null;
    walkElements(root, (element) => {
        if (!match && predicate(element)) {
            match = element;
        }
    });
    return match;
}

const body = createElement('body');
const documentRef = createDocument(body);

const sandbox = {
    console,
    marked: {},
    DOMPurify: { sanitize(value) { return value; } },
    chrome: {
        runtime: {
            getURL(resourcePath) { return resourcePath; },
            onMessage: { addListener() {} },
            sendMessage() {}
        },
        storage: {
            local: {
                async get() { return {}; },
                async set() {}
            }
        }
    },
    document: documentRef,
    window: {
        location: documentRef.location,
        getComputedStyle(element) {
            return element.styleState;
        }
    }
};

sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${contentScript}\nglobalThis.__semanticContextTestExports = {
    buildApproximateAccessibilityTree,
    buildConversationContextText,
    buildSystemPrompt,
    getInquiryPageContext
};`, sandbox, { filename: 'content.js' });

const {
    buildApproximateAccessibilityTree,
    buildConversationContextText,
    buildSystemPrompt,
    getInquiryPageContext
} = sandbox.__semanticContextTestExports;

const heading = createElement('h1', {}, [createTextNode('帳戶設定')]);
const navigation = createElement('nav', { 'aria-label': '主要導覽' }, [
    createElement('a', { href: '/home' }, [createTextNode('首頁')])
]);
const paragraphWithLink = createElement('p', {}, [
    createTextNode('前往'),
    createElement('a', { href: '/profile' }, [createTextNode('個人資料')])
]);
const emailLabel = createElement('span', { id: 'email-label' }, [createTextNode('電子郵件')]);
const emailInput = createElement('input', {
    id: 'email',
    type: 'email',
    'aria-labelledby': 'email-label',
    required: ''
});
emailInput.value = 'user@example.com';
emailInput.required = true;
const passwordInput = createElement('input', {
    type: 'password',
    'aria-label': '密碼'
});
passwordInput.value = 'never-send-this';
const checkbox = createElement('input', {
    type: 'checkbox',
    'aria-label': '訂閱通知',
    'aria-checked': 'false'
});
const hiddenContent = createElement('section', { 'aria-hidden': 'true' }, [
    createElement('p', {}, [createTextNode('不應出現')])
]);
const dialogHost = createElement('div', { id: 'askpage-dialog-host' }, [
    createElement('p', {}, [createTextNode('擴充功能介面')])
]);
const shadowHost = createElement('account-card');
shadowHost.shadowRoot = {
    nodeType: 11,
    childNodes: [createElement('button', {}, [createTextNode('儲存設定')])]
};

const main = createElement('main', {}, [
    heading,
    paragraphWithLink,
    emailLabel,
    emailInput,
    passwordInput,
    checkbox,
    hiddenContent,
    shadowHost
]);
appendChild(body, navigation);
appendChild(body, main);
appendChild(body, dialogHost);
assignDocument(body, documentRef);

const semanticContext = buildApproximateAccessibilityTree(body, {
    document: documentRef,
    getComputedStyle(element) { return element.styleState; }
});

assert.strictEqual(semanticContext.isTruncated, false);
assert.match(semanticContext.content, /^document "測試頁面" \[url="https:\/\/example\.com\/page"\]/);
assert.match(semanticContext.content, /navigation "主要導覽"/);
assert.match(semanticContext.content, /link "首頁" \[url="\/home"\]/);
assert.match(semanticContext.content, /heading \[level="1"\]\n\s+text "帳戶設定"/);
assert.match(semanticContext.content, /paragraph\n\s+text "前往"\n\s+link "個人資料" \[url="\/profile"\]/);
assert.match(semanticContext.content, /textbox "電子郵件" \[value="user@example\.com", required="true"\]/);
assert.match(semanticContext.content, /textbox "密碼"/);
assert.doesNotMatch(semanticContext.content, /never-send-this/);
assert.match(semanticContext.content, /checkbox "訂閱通知" \[checked="false"\]/);
assert.match(semanticContext.content, /button "儲存設定"/);
assert.doesNotMatch(semanticContext.content, /不應出現/);
assert.doesNotMatch(semanticContext.content, /擴充功能介面/);

const genericBody = createElement('body', {}, [
    createElement('div', {}, [createTextNode('第一段'), createElement('span', {}, [createTextNode('第二段')])])
]);
const genericDocument = createDocument(genericBody, '泛用容器');
const genericContext = buildApproximateAccessibilityTree(genericBody, {
    document: genericDocument,
    getComputedStyle(element) { return element.styleState; }
});
assert.match(genericContext.content, /text "第一段 第二段"/);
assert.doesNotMatch(genericContext.content, /generic/);

const longText = `完整長文-${'內容'.repeat(10000)}-長文結尾`;
const longBody = createElement('body', {}, [
    createElement('p', {}, [createTextNode(longText)])
]);
const longDocument = createDocument(longBody, '無裁切測試');
const unlimitedContext = buildApproximateAccessibilityTree(longBody, {
    document: longDocument,
    getComputedStyle(element) { return element.styleState; }
});
assert.strictEqual(unlimitedContext.isTruncated, false);
assert.ok(unlimitedContext.content.length > 15000);
assert.ok(unlimitedContext.content.includes(longText));

const systemPrompt = buildSystemPrompt({
    pageContextFormat: 'semantic-tree',
    pageContextIsFiltered: true,
    pageContextIsTruncated: true
});
assert.match(systemPrompt, /DOM-derived approximation/);
assert.match(systemPrompt, /password values/);
assert.match(systemPrompt, /in inquiry mode/);

const conversationContext = buildConversationContextText({
    content: semanticContext.content,
    format: 'semantic-tree'
}, '選取內容');
assert.match(conversationContext, /Approximate page accessibility tree/);
assert.match(conversationContext, /Selected text \(main focus\):\n選取內容$/);

const longSelectedText = `選取開頭-${'選取內容'.repeat(2000)}-選取結尾`;
const longSelectionContext = buildConversationContextText({
    content: semanticContext.content,
    format: 'semantic-tree'
}, longSelectedText);
assert.ok(longSelectionContext.endsWith(longSelectedText));

const fallbackText = `降級開頭-${'頁面文字'.repeat(5000)}-降級結尾`;
const fallbackContainer = { innerText: fallbackText };
const fallbackContext = getInquiryPageContext(fallbackContainer, body, () => {
    throw new Error('模擬語意樹建立失敗');
});
assert.strictEqual(fallbackContext.format, 'text');
assert.strictEqual(fallbackContext.content, fallbackText);
assert.ok(fallbackContext.content.length > 15000);
assert.strictEqual(fallbackContext.isTruncated, false);

console.log('semantic-page-context: ok');
