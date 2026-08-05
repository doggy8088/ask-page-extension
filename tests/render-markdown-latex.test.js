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

const reportedMultilineFormula = String.raw`$$
\oint_{\mathcal{C}} \frac{f(z)}{(z - z_0)^{n+1}} \, dz = \frac{2\pi i}{n!} f^{(n)}(z_0) \quad \text{where } f(z) = \sum_{k=0}^{\infty} \frac{a_k}{\Gamma(k + \alpha)} \int_{0}^{\infty} t^{k + \alpha - 1} e^{-tz} \, dt
$$`;
const renderedMultilineFormula = renderMarkdown(reportedMultilineFormula);
const renderedReportedFormula = katex.renderToString(reportedMultilineFormula.slice(2, -2), {
    displayMode: true,
    throwOnError: false,
    trust: false
});

assert.doesNotMatch(renderedMultilineFormula, /\$\$<br>/);
assert.doesNotMatch(renderedMultilineFormula, /<br>\$\$/);
assert.match(renderedMultilineFormula, /\\, dz/);
assert.match(renderedMultilineFormula, /\\, dt/);
assert.match(renderedMultilineFormula, /\$\$\n\\oint/);
assert.match(renderedMultilineFormula, /dt\n\$\$/);
assert.match(renderedReportedFormula, /class="katex"/);
assert.doesNotMatch(renderedReportedFormula, /class="katex-error"/);

assert.strictEqual(
    renderMarkdown('before\n\\[\nx^2 + y^2\n\\]\nafter'),
    '<p>before<br>\\[\nx^2 + y^2\n\\]<br>after</p>\n'
);

[
    ['equation', 'x = 1'],
    ['align', 'x &= 1 \\\\ y &= 2'],
    ['alignat', 'x &={} y'],
    ['gather', 'x = 1 \\\\ y = 2'],
    ['CD', 'A @>f>> B']
].forEach(([environment, formula]) => {
    const renderedEnvironment = renderMarkdown(
        `\\begin{${environment}}\n${formula}\n\\end{${environment}}`
    );
    assert.doesNotMatch(renderedEnvironment, /<br>/);
    assert.match(renderedEnvironment, new RegExp(`\\\\begin\\{${environment}\\}\\n`));
    assert.match(renderedEnvironment, new RegExp(`\\n\\\\end\\{${environment}\\}`));
});

assert.match(renderMarkdown('`$$\\frac{1}{2}$$`'), /<code>\$\$\\frac\{1\}\{2\}\$\$<\/code>/);
assert.match(renderMarkdown('價格 $0.0045\n下一行'), /價格 \$0\.0045<br>下一行/);
assert.match(renderMarkdown('$$\nunclosed'), /\$\$<br>unclosed/);
const renderedUnsafeFormula = renderMarkdown('$$\n\\text{<img src=x onerror=alert(1)>}\n$$');
assert.match(renderedUnsafeFormula, /\\text\{&lt;img src=x onerror=alert\(1\)&gt;\}/);
assert.doesNotMatch(renderedUnsafeFormula, /<img\b/);

const fallbackSandbox = {
    console,
    marked: {
        parse() {
            throw new Error('forced Markdown parser failure');
        }
    },
    DOMPurify: sandbox.DOMPurify,
    renderMathInElement() {},
    chrome: sandbox.chrome,
    document: sandbox.document,
    window: sandbox.window
};
fallbackSandbox.globalThis = fallbackSandbox;
vm.createContext(fallbackSandbox);
vm.runInContext(`${contentScript}\nglobalThis.__askPageFallbackRenderMarkdown = renderMarkdown;`, fallbackSandbox, {
    filename: 'content.js'
});
assert.strictEqual(
    fallbackSandbox.__askPageFallbackRenderMarkdown('before\n$$\nx^2\n$$\nafter'),
    'before<br>$$\nx^2\n$$<br>after'
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
