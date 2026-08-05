'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const marked = require(path.join(rootDir, 'lib', 'marked.min.js'));
const zhTwMessages = require(path.join(rootDir, '_locales', 'zh_TW', 'messages.json'));
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');

function localizeMessage(key, substitutions = {}) {
    const message = zhTwMessages[key]?.message || key;
    return message.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\$/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(substitutions, name) ? String(substitutions[name]) : match
    ));
}

const sandbox = {
    console,
    marked,
    AskPageI18n: {
        t: localizeMessage
    },
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
    createApiTokenUsageAccumulator,
    createApiTokenUsageSummary,
    createCodePenPrefillForm,
    createMarkdownCodeFence,
    extractHtmlDocumentTitle,
    formatApiTokenUsageSummary,
    getResponsesApiOutputTextFromResponse,
    splitHtmlForCodePen,
    getAssistantDisplayMarkdown,
    getAssistantStoredText,
    isRawHtmlAssistantResponse,
    mergeApiTokenUsageSummary,
    normalizePairedStrongMarkersInMarkdown,
    renderMarkdown,
    shouldCollapseTextPreview
};`, sandbox, {
    filename: 'content.js'
});

const {
    buildCodePenPrefillData,
    createApiTokenUsageAccumulator,
    createApiTokenUsageSummary,
    createCodePenPrefillForm,
    createMarkdownCodeFence,
    extractHtmlDocumentTitle,
    formatApiTokenUsageSummary,
    getResponsesApiOutputTextFromResponse,
    splitHtmlForCodePen,
    getAssistantDisplayMarkdown,
    getAssistantStoredText,
    isRawHtmlAssistantResponse,
    mergeApiTokenUsageSummary,
    normalizePairedStrongMarkersInMarkdown,
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

const strongBoundaryMarkdown = '根據頁面中的計價資訊，**gpt-transcribe** 的費用是以**音訊長度（每分鐘）**計算：';
const normalizedStrongBoundaryMarkdown = normalizePairedStrongMarkersInMarkdown(strongBoundaryMarkdown);
const renderedStrongBoundaryMarkdown = renderMarkdown(strongBoundaryMarkdown);

assert.strictEqual(
    normalizedStrongBoundaryMarkdown,
    '根據頁面中的計價資訊，<strong>gpt-transcribe</strong> 的費用是以<strong>音訊長度（每分鐘）</strong>計算：'
);
assert.match(renderedStrongBoundaryMarkdown, /<strong>gpt-transcribe<\/strong>/);
assert.match(renderedStrongBoundaryMarkdown, /以<strong>音訊長度（每分鐘）<\/strong>計算/);
assert.doesNotMatch(renderedStrongBoundaryMarkdown, /\*\*/);

assert.strictEqual(
    normalizePairedStrongMarkersInMarkdown('A**包含，標點。**B**第二組（半形）**C'),
    'A<strong>包含，標點。</strong>B<strong>第二組（半形）</strong>C'
);
assert.strictEqual(
    normalizePairedStrongMarkersInMarkdown('單一標記 ** 不修改'),
    '單一標記 ** 不修改'
);
assert.strictEqual(
    normalizePairedStrongMarkersInMarkdown('奇數標記 **一**二** 不修改'),
    '奇數標記 **一**二** 不修改'
);
assert.strictEqual(
    normalizePairedStrongMarkersInMarkdown('行內程式碼 `**code**` 與 **粗體**'),
    '行內程式碼 `**code**` 與 <strong>粗體</strong>'
);
assert.strictEqual(
    normalizePairedStrongMarkersInMarkdown('跳脫標記 \\**不轉換\\** 與 **粗體**'),
    '跳脫標記 \\**不轉換\\** 與 <strong>粗體</strong>'
);
assert.strictEqual(
    normalizePairedStrongMarkersInMarkdown('保留 ***粗斜體*** 與 **粗體**'),
    '保留 ***粗斜體*** 與 <strong>粗體</strong>'
);
assert.strictEqual(
    normalizePairedStrongMarkersInMarkdown('```md\n**程式碼**\n```\n**一般文字**'),
    '```md\n**程式碼**\n```\n<strong>一般文字</strong>'
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

const tokenUsage = createApiTokenUsageAccumulator();
mergeApiTokenUsageSummary(tokenUsage, createApiTokenUsageSummary('Gemini', {
    promptTokenCount: 1000,
    cachedContentTokenCount: 250,
    candidatesTokenCount: 300,
    thoughtsTokenCount: 40,
    totalTokenCount: 1340
}));
mergeApiTokenUsageSummary(tokenUsage, createApiTokenUsageSummary('OpenAI', {
    prompt_tokens: 2000,
    prompt_tokens_details: {
        cached_tokens: 500
    },
    completion_tokens: 700,
    completion_tokens_details: {
        reasoning_tokens: 120,
        accepted_prediction_tokens: 30,
        rejected_prediction_tokens: 10
    },
    total_tokens: 2700
}));
mergeApiTokenUsageSummary(tokenUsage, createApiTokenUsageSummary('Anthropic', {
    input_tokens: 300,
    cache_creation_input_tokens: 50,
    cache_read_input_tokens: 80,
    output_tokens: 90
}));

assert.deepStrictEqual(JSON.parse(JSON.stringify(tokenUsage)), {
    callCount: 3,
    fields: {
        inputTokens: 3300,
        inputCachedTokens: 830,
        outputTokens: 1090,
        outputReasoningTokens: 160,
        totalTokens: 4040,
        acceptedPredictionTokens: 30,
        rejectedPredictionTokens: 10,
        inputCacheCreationTokens: 50
    }
});
assert.strictEqual(
    formatApiTokenUsageSummary(tokenUsage),
    'Token 用量統計：\n- 輸入：3,300（快取 830、快取寫入 50）\n- 輸出：1,090（推理 160、已接受預測 30、已否決預測 10）\n- 總計：4,040'
);
assert.strictEqual(createApiTokenUsageSummary('Unknown', { foo: 'bar' }), null);
assert.strictEqual(formatApiTokenUsageSummary(createApiTokenUsageAccumulator()), '');

assert.strictEqual(getResponsesApiOutputTextFromResponse({
    output: [{
        type: 'message',
        content: [{
            type: 'text',
            text: 'fallback text part'
        }]
    }]
}), 'fallback text part');

assert.strictEqual(getResponsesApiOutputTextFromResponse({
    output: [{
        type: 'message',
        content: [{
            type: 'output_text',
            text: {
                value: 'nested text value'
            }
        }]
    }]
}), 'nested text value');

assert.strictEqual(getResponsesApiOutputTextFromResponse({
    output: [{
        type: 'message',
        content: 'direct message content'
    }]
}), 'direct message content');

assert.strictEqual(getResponsesApiOutputTextFromResponse({
    output: [{
        type: 'function_call',
        name: 'run_js',
        arguments: '{"code":"document.title"}'
    }]
}), '');

console.log('render-markdown-code-fence: ok');
