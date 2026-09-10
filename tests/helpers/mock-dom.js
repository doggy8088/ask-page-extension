'use strict';

// 極簡 DOM 模擬，供 content.js 純函式層的測試使用。
// 只實作語意樹與代理快照建構所需的最小介面，不依賴 jsdom。

function createTextNode(text) {
    return {
        nodeType: 3,
        textContent: text,
        parentElement: null,
        isConnected: true
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
        isConnected: true,
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
        },
        setAttribute(name, value) {
            normalizedAttributes[name] = String(value);
        },
        removeAttribute(name) {
            delete normalizedAttributes[name];
        },
        contains(node) {
            let current = node;
            while (current) {
                if (current === element) {
                    return true;
                }
                current = current.parentElement;
            }
            return false;
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

function createDocument(body, title = '測試頁面', options = {}) {
    const documentRef = {
        title,
        body,
        documentElement: { lang: options.lang || 'zh-TW' },
        location: { href: options.href || 'https://example.com/page' },
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

function createContentScriptSandbox(documentRef, exportsExpression) {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const rootDir = path.resolve(__dirname, '..', '..');
    const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');

    const sandbox = {
        console,
        marked: {},
        DOMPurify: { sanitize(value) { return value; } },
        WeakRef,
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
            innerWidth: 1280,
            innerHeight: 800,
            getComputedStyle(element) {
                return element.styleState;
            }
        }
    };

    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${contentScript}\nglobalThis.__testExports = ${exportsExpression};`, sandbox, { filename: 'content.js' });
    return sandbox.__testExports;
}

module.exports = {
    createTextNode,
    createElement,
    appendChild,
    assignDocument,
    walkElements,
    findElement,
    createDocument,
    createContentScriptSandbox
};
