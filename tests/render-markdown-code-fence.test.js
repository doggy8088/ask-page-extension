'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const marked = require(path.join(rootDir, 'lib', 'marked.min.js'));
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');

const sandbox = {
    console,
    marked,
    DOMPurify: {
        sanitize(html) {
            return html;
        }
    },
    chrome: {
        runtime: {
            getURL(resourcePath) {
                return resourcePath;
            },
            onMessage: {
                addListener() {}
            },
            sendMessage() {}
        }
    },
    document: {
        readyState: 'complete'
    },
    window: {
        location: {
            href: 'about:blank'
        }
    }
};

sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(`${contentScript}\nglobalThis.__askPageTestExports = {
    buildCodePenPrefillData,
    createCodePenPrefillForm,
    createMarkdownCodeFence,
    extractHtmlDocumentTitle,
    splitHtmlForCodePen,
    getAssistantDisplayMarkdown,
    getAssistantStoredText,
    isRawHtmlAssistantResponse,
    renderMarkdown,
    shouldCollapseTextPreview
};`, sandbox, {
    filename: 'content.js'
});

const {
    buildCodePenPrefillData,
    createCodePenPrefillForm,
    createMarkdownCodeFence,
    extractHtmlDocumentTitle,
    splitHtmlForCodePen,
    getAssistantDisplayMarkdown,
    getAssistantStoredText,
    isRawHtmlAssistantResponse,
    renderMarkdown,
    shouldCollapseTextPreview
} = sandbox.__askPageTestExports;

const fullHtml = [
    '<!doctype html>',
    '<html lang="zh-Hant-TW">',
    '<head>',
    '  <style>',
    '    body { color: red; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <script>',
    '    const closingScript = "</script>";',
    '    const closingStyle = "</style>";',
    '  </script>',
    '</body>',
    '</html>'
].join('\n');

const renderedFullHtml = renderMarkdown(`\`\`\`html\n${fullHtml}\n\`\`\``);

assert.match(renderedFullHtml, /<pre><code class="language-html">/);
assert.match(renderedFullHtml, /&lt;!doctype html&gt;/);
assert.match(renderedFullHtml, /&lt;script&gt;/);
assert.match(renderedFullHtml, /&lt;\/script&gt;/);
assert.match(renderedFullHtml, /&lt;style&gt;/);
assert.match(renderedFullHtml, /&lt;\/style&gt;/);
assert.doesNotMatch(renderedFullHtml, /<\/?(?:script|style|html|head|body)(?:\s|>)/i);

const renderedSingleLineHtml = renderMarkdown('```html\n<div>copy me exactly</div>\n```');

assert.match(
    renderedSingleLineHtml,
    /&lt;div&gt;copy me exactly&lt;\/div&gt;<\/code><\/pre>\n$/
);

assert.strictEqual(isRawHtmlAssistantResponse(`\n  ${fullHtml}`), true);
assert.strictEqual(isRawHtmlAssistantResponse('<section data-kind="quiz">content</section>'), true);
assert.strictEqual(isRawHtmlAssistantResponse('Here is <section>inline HTML</section>'), false);

const htmlWithMarkdownFenceText = [
    '<!doctype html>',
    '<html>',
    '<body>',
    '<script>',
    'const markdownFence = "```";',
    '</script>',
    '</body>',
    '</html>'
].join('\n');
const autoCodeFenceMarkdown = getAssistantDisplayMarkdown(htmlWithMarkdownFenceText);
const renderedAutoCodeFenceHtml = renderMarkdown(autoCodeFenceMarkdown);

assert.strictEqual(getAssistantStoredText(htmlWithMarkdownFenceText), htmlWithMarkdownFenceText);
assert.match(autoCodeFenceMarkdown, /^````html\n/);
assert.match(renderedAutoCodeFenceHtml, /<pre><code class="language-html">/);
assert.match(renderedAutoCodeFenceHtml, /&lt;!doctype html&gt;/);
assert.match(renderedAutoCodeFenceHtml, /const markdownFence = &quot;```&quot;;/);
assert.doesNotMatch(renderedAutoCodeFenceHtml, /<\/?(?:script|html|body)(?:\s|>)/i);

assert.strictEqual(
    createMarkdownCodeFence('<div>plain html</div>', 'html'),
    '```html\n<div>plain html</div>\n```'
);

assert.strictEqual(shouldCollapseTextPreview('1\n2\n3\n4\n5'), false);
assert.strictEqual(shouldCollapseTextPreview('1\n2\n3\n4\n5\n6'), true);
assert.strictEqual(shouldCollapseTextPreview('x'.repeat(601)), true);

assert.strictEqual(extractHtmlDocumentTitle('<title>  Quiz Demo  </title>'), 'Quiz Demo');
assert.strictEqual(extractHtmlDocumentTitle('<main>No title</main>'), '');

const codePenFullHtml = [
    '<!doctype html>',
    '<html lang="zh-Hant-TW">',
    '<head>',
    '  <style>',
    '    body { color: red; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <script>',
    '    const closingScript = "<\\/script>";',
    '  </script>',
    '</body>',
    '</html>'
].join('\n');
const codePenData = buildCodePenPrefillData(codePenFullHtml);

assert.strictEqual(codePenData.title, 'AskPage HTML Output');
assert.strictEqual(codePenData.description, 'Generated from AskPage');
assert.strictEqual(codePenData.html, '');
assert.strictEqual(codePenData.css, 'body { color: red; }');
assert.strictEqual(codePenData.js, 'const closingScript = "<\\/script>";');
assert.strictEqual(codePenData.layout, 'left');

const codePenDocument = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Generated Quiz</title>',
    '<link rel="stylesheet" href="https://cdn.example.com/quiz.css">',
    '<style>.card { color: red; }</style>',
    '</head>',
    '<body>',
    '<main class="card">Quiz</main>',
    '<script src="https://cdn.example.com/quiz.js"></script>',
    '<script>console.log("ready");</script>',
    '</body>',
    '</html>'
].join('\n');
const splitCodePenDocument = splitHtmlForCodePen(codePenDocument);
const titledCodePenData = buildCodePenPrefillData(codePenDocument);

assert.strictEqual(splitCodePenDocument.title, 'Generated Quiz');
assert.strictEqual(splitCodePenDocument.head, '<meta name="viewport" content="width=device-width, initial-scale=1">');
assert.strictEqual(splitCodePenDocument.html, '<main class="card">Quiz</main>');
assert.strictEqual(splitCodePenDocument.css, '.card { color: red; }');
assert.strictEqual(splitCodePenDocument.js, 'console.log("ready");');
assert.strictEqual(splitCodePenDocument.css_external, 'https://cdn.example.com/quiz.css');
assert.strictEqual(splitCodePenDocument.js_external, 'https://cdn.example.com/quiz.js');
assert.strictEqual(titledCodePenData.title, 'Generated Quiz');
assert.strictEqual(titledCodePenData.head, '<meta name="viewport" content="width=device-width, initial-scale=1">');
assert.strictEqual(titledCodePenData.html, '<main class="card">Quiz</main>');
assert.strictEqual(titledCodePenData.css, '.card { color: red; }');
assert.strictEqual(titledCodePenData.js, 'console.log("ready");');
assert.strictEqual(titledCodePenData.css_external, 'https://cdn.example.com/quiz.css');
assert.strictEqual(titledCodePenData.js_external, 'https://cdn.example.com/quiz.js');

function createFakeElement(tagName) {
    return {
        tagName,
        children: [],
        style: {},
        appendChild(child) {
            this.children.push(child);
            return child;
        }
    };
}

sandbox.document = {
    createElement: createFakeElement
};

const codePenForm = createCodePenPrefillForm(titledCodePenData);
const codePenFormDataInput = codePenForm.children[0];

assert.strictEqual(codePenForm.action, 'https://codepen.io/cpe/pen/define/');
assert.strictEqual(codePenForm.method, 'POST');
assert.strictEqual(codePenForm.target, '_blank');
assert.strictEqual(codePenForm.style.display, 'none');
assert.strictEqual(codePenFormDataInput.type, 'hidden');
assert.strictEqual(codePenFormDataInput.name, 'data');
assert.deepStrictEqual(JSON.parse(codePenFormDataInput.value), JSON.parse(JSON.stringify(titledCodePenData)));

console.log('render-markdown-code-fence: ok');
