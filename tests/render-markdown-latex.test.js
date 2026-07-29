'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const marked = require(path.join(rootDir, 'lib', 'marked.min.js'));
const katex = require(path.join(rootDir, 'lib', 'katex', 'katex.min.js'));
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const renderCalls = [];

const sandbox = {
    console,
    marked,
    DOMPurify: {
        sanitize(html) {
            return html;
        }
    },
    renderMathInElement(element, options) {
        renderCalls.push({ element, options });
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
vm.runInContext(`${contentScript}\nglobalThis.__askPageLatexTestExports = {
    escapeUnescapedLatexDollarSigns,
    renderLatexInElement,
    renderMarkdown
};`, sandbox, {
    filename: 'content.js'
});

const {
    escapeUnescapedLatexDollarSigns,
    renderLatexInElement,
    renderMarkdown
} = sandbox.__askPageLatexTestExports;

assert.strictEqual(
    escapeUnescapedLatexDollarSigns('$0.0045 = \\mathbf{$0.00225}'),
    '\\$0.0045 = \\mathbf{\\$0.00225}'
);
assert.strictEqual(
    escapeUnescapedLatexDollarSigns('\\$0.0045 + \\\\$0.00225'),
    '\\$0.0045 + \\\\\\$0.00225'
);

assert.match(renderMarkdown('\\(x^2 + y^2 = z^2\\)'), /\\\(x\^2 \+ y\^2 = z\^2\\\)/);
assert.match(renderMarkdown('\\[\\frac{1}{2}\\]'), /\\\[\\frac\{1\}\{2\}\\\]/);
assert.match(
    renderMarkdown('```latex\n\\(x^2\\)\n```'),
    /<pre><code class="language-latex">\\\(x\^2\\\)<\/code><\/pre>/
);

const targetElement = {};
renderLatexInElement(targetElement);

assert.strictEqual(renderCalls.length, 1);
assert.strictEqual(renderCalls[0].element, targetElement);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(renderCalls[0].options.delimiters)),
    [
        { left: '$$', right: '$$', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\begin{equation}', right: '\\end{equation}', display: true },
        { left: '\\begin{align}', right: '\\end{align}', display: true },
        { left: '\\begin{alignat}', right: '\\end{alignat}', display: true },
        { left: '\\begin{gather}', right: '\\end{gather}', display: true },
        { left: '\\begin{CD}', right: '\\end{CD}', display: true },
        { left: '\\[', right: '\\]', display: true }
    ]
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(renderCalls[0].options.ignoredTags)),
    ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option']
);
assert.strictEqual(renderCalls[0].options.throwOnError, false);
assert.strictEqual(renderCalls[0].options.trust, false);

const screenshotFormula = renderCalls[0].options.preProcess(
    '$0.0045 \\times 0.5 = \\mathbf{$0.00225 \\text{ 美元}}'
);
const renderedFormula = katex.renderToString(screenshotFormula, {
    displayMode: true,
    throwOnError: false,
    trust: false
});

assert.match(renderedFormula, /class="katex"/);
assert.doesNotMatch(renderedFormula, /class="katex-error"/);

const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const contentScripts = manifest.content_scripts[0].js;
const katexIndex = contentScripts.indexOf('lib/katex/katex.min.js');
const autoRenderIndex = contentScripts.indexOf('lib/katex/auto-render.min.js');

assert.ok(katexIndex >= 0);
assert.ok(autoRenderIndex > katexIndex);
assert.ok(contentScripts.indexOf('content.js') > autoRenderIndex);

console.log('render-markdown-latex: ok');
