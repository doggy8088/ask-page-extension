'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const i18nScript = fs.readFileSync(path.join(rootDir, 'i18n.js'), 'utf8');

class FakeElement {
    constructor(tagName, parentElement = null) {
        this.nodeType = 1;
        this.tagName = tagName.toUpperCase();
        this.parentElement = parentElement;
        this.attributes = new Map();
        this.descendants = [];
        this.textNodes = [];
    }

    closest(selector) {
        const tagNames = selector.split(',').map((value) => value.trim().toUpperCase());
        let element = this;

        while (element) {
            if (tagNames.includes(element.tagName)) {
                return element;
            }
            element = element.parentElement;
        }

        return null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, value);
    }

    querySelectorAll() {
        return this.descendants;
    }
}

class FakeTextNode {
    constructor(nodeValue, parentElement) {
        this.nodeType = 3;
        this.nodeValue = nodeValue;
        this.parentElement = parentElement;
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
    readyState: 'complete',
    createTreeWalker(root) {
        const textNodes = root.textNodes || [];
        let index = -1;

        return {
            currentNode: null,
            nextNode() {
                index += 1;
                this.currentNode = textNodes[index] || null;
                return Boolean(this.currentNode);
            }
        };
    },
    addEventListener() {}
};

const sandbox = {
    chrome: {
        i18n: {
            getUILanguage() {
                return 'en-US';
            }
        }
    },
    document,
    location: {
        protocol: 'https:'
    },
    MutationObserver: FakeMutationObserver,
    Node: {
        ELEMENT_NODE: 1,
        TEXT_NODE: 3
    },
    NodeFilter: {
        SHOW_TEXT: 4
    },
    window: {
        alert() {},
        confirm() {},
        prompt() {}
    }
};

sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(i18nScript, sandbox, {
    filename: 'i18n.js'
});

const { observe, translateText } = sandbox.window.AskPageI18n;

assert.strictEqual(translateText('取消'), 'Cancel');
assert.strictEqual(translateText(' \n取消\n '), ' \nCancel\n ');
assert.strictEqual(translateText(''), '');
assert.strictEqual(translateText(' '), ' ');
assert.strictEqual(translateText('\n  '), '\n  ');
assert.strictEqual(translateText(translateText('\n  ')), '\n  ');

const root = new FakeElement('div');
const normalElement = new FakeElement('div', root);
const codeElement = new FakeElement('code', root);
const highlightedSpan = new FakeElement('span', codeElement);
const normalText = new FakeTextNode('取消', normalElement);
const whitespaceText = new FakeTextNode('\n  ', normalElement);
const codeText = new FakeTextNode('取消\n  ', highlightedSpan);

normalElement.setAttribute('title', '取消');
codeElement.setAttribute('title', '取消');
root.textNodes = [normalText, whitespaceText, codeText];
root.descendants = [normalElement, codeElement, highlightedSpan];

observe(root);

assert.strictEqual(normalText.nodeValue, 'Cancel');
assert.strictEqual(whitespaceText.nodeValue, '\n  ');
assert.strictEqual(codeText.nodeValue, '取消\n  ');
assert.strictEqual(normalElement.getAttribute('title'), 'Cancel');
assert.strictEqual(codeElement.getAttribute('title'), '取消');

const observer = FakeMutationObserver.instances[0];
const addedNormalText = new FakeTextNode('取消', normalElement);
const addedCodeSpan = new FakeElement('span', codeElement);
const addedCodeText = new FakeTextNode('取消\n  ', addedCodeSpan);

addedCodeSpan.textNodes = [addedCodeText];
observer.callback([{
    type: 'childList',
    addedNodes: [addedNormalText, addedCodeSpan]
}]);

assert.strictEqual(addedNormalText.nodeValue, 'Cancel');
assert.strictEqual(addedCodeText.nodeValue, '取消\n  ');

console.log('i18n-code-block: ok');
