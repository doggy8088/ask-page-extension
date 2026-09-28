'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const zhTwCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, '_locales', 'zh_TW', 'messages.json'), 'utf8'));

function sliceSource(startMarker, endMarker) {
    const start = contentScript.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `找不到 ${startMarker}`);
    const end = contentScript.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, `找不到 ${endMarker}`);
    return contentScript.slice(start, end);
}

const sandbox = {
    getLocalizedText(key, substitutions = {}) {
        const message = zhTwCatalog[key]?.message || key;
        return message.replace(/\$([A-Za-z][A-Za-z0-9_]*)\$/g, (match, name) => substitutions[name] ?? match);
    },
    formatToolDisplayName: (name) => name || '未知工具',
    truncateToolText(value, maxLength = 400) {
        const text = String(value || '');
        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    },
    getJsonPreview: (value) => JSON.stringify(value, null, 2),
    renderMarkdown: (markdown) => `<p>${markdown}</p>`
};
vm.createContext(sandbox);
vm.runInContext(`
${sliceSource('function escapeHtml(', 'function getSafeMarkdownCodeLanguageClass(')}
${sliceSource('    const TOOL_TRACE_ICON_PATHS', '    function updateToolTraceMessage(')}
this.buildToolTraceMessage = buildToolTraceMessage;
this.formatToolArgumentsPreview = formatToolArgumentsPreview;
this.buildReasoningTraceHtml = buildReasoningTraceHtml;
`, sandbox);

const { buildToolTraceMessage, formatToolArgumentsPreview, buildReasoningTraceHtml } = sandbox;
const runJsCall = { name: 'run_js', args: { code: 'return document\n    .querySelectorAll(".project").length;' } };

assert.strictEqual(
    formatToolArgumentsPreview(runJsCall.args),
    'return document .querySelectorAll(".project").length;',
    '單一字串參數應直接顯示內容並壓成一行'
);
assert.strictEqual(formatToolArgumentsPreview({ mode: 'text', ref: 'e12' }), 'mode: "text", ref: "e12"');

const pending = buildToolTraceMessage('tool-a-1', runJsCall);
assert.match(pending.renderedHtml, /data-state="pending"/);
assert.match(pending.renderedHtml, /data-askpage-tool-trace-id="tool-a-1"/);
assert.match(pending.renderedHtml, /querySelectorAll\(&quot;\.project&quot;\)/, '執行中應顯示參數預覽');
assert.doesNotMatch(pending.renderedHtml, /askpage-tool-trace-duration/);
assert.strictEqual((pending.renderedHtml.match(/askpage-tool-trace-section/g) || []).length, 1, '執行中只有參數區段');

const success = buildToolTraceMessage('tool-a-1', runJsCall, {
    result: { success: true, message: '已執行 <script>。', data: { count: 12 } },
    durationMs: 412.4
});
assert.match(success.renderedHtml, /data-state="success"/);
assert.match(success.renderedHtml, /已執行 &lt;script&gt;。/, '結果摘要必須跳脫 HTML');
assert.doesNotMatch(success.renderedHtml, /<script>/);
assert.match(success.renderedHtml, /<span class="askpage-tool-trace-duration">412ms<\/span>/);
assert.strictEqual((success.renderedHtml.match(/askpage-tool-trace-section/g) || []).length, 2, '完成後同時有參數與結果區段');

const failure = buildToolTraceMessage('tool-a-2', { name: 'click', args: { ref: 'e48' } }, {
    result: { success: false, message: '' },
    durationMs: 1830
});
assert.match(failure.renderedHtml, /data-state="failure"/);
assert.match(failure.renderedHtml, /失敗/, '失敗但沒有訊息時應顯示失敗');
assert.match(failure.renderedHtml, />1\.8s</);

const stopped = buildToolTraceMessage('tool-a-3', runJsCall, null, 'stopped');
assert.match(stopped.renderedHtml, /data-state="stopped"/);
assert.match(stopped.renderedHtml, /已中止/);

const reasoningHtml = buildReasoningTraceHtml('先找出專案清單，\n\n再確認分頁。');
assert.match(reasoningHtml, /^<details class="askpage-tool-trace askpage-reasoning-trace" data-state="reasoning">/, '思考過程預設收合');
assert.match(reasoningHtml, />思考過程</);
assert.match(reasoningHtml, /<span class="askpage-tool-trace-summary">先找出專案清單， 再確認分頁。<\/span>/, '摘要壓成一行');
assert.match(reasoningHtml, /<div class="askpage-reasoning-trace-body"><p>先找出專案清單，/, '展開區保留完整的 Markdown 內容');

const reporterSource = sliceSource('    function createExecutionTraceReporter()', '    function logAgentExecutionCompletion(');
const reportToolResultsSource = reporterSource.slice(reporterSource.indexOf('reportToolResults('), reporterSource.indexOf('reportUsage('));
assert.match(reportToolResultsSource, /updateToolTraceMessage\(entry, toolResult\)/, '工具結果應就地更新同一列');
assert.doesNotMatch(reportToolResultsSource, /appendAgentTraceMessage/, '工具結果不可再另外新增一則訊息');
assert.match(reporterSource, /pendingToolTraces\.splice\(0\)\.forEach\(\(entry\) => updateToolTraceMessage\(entry, null, 'stopped'\)\)/);

assert.match(
    sliceSource('    async function executeToolCalls(', '    function getAssistantMessageText('),
    /durationMs: performance\.now\(\) - startedAt/
);
assert.match(reporterSource, /reportToolCalls\(toolCalls\) \{[\s\S]*?finishStreamedReasoning\(\);/, '每輪工具呼叫前要結束這一輪的思考列');
assert.match(reporterSource, /reportCompletion\(message\) \{\s*finishStreamedReasoning\(\);/);
assert.match(reporterSource, /appendAgentTraceMessage\(`🧠 \$\{reasoningText\}`, 'reasoning', \{\s*renderedHtml: buildReasoningTraceHtml\(reasoningText\)/);

assert.match(contentScript, /if \(!useTools \|\| round === 0\) \{/, '第二輪起不再顯示規劃狀態');
assert.match(contentScript, /if \(!enableTools \|\| round === 0\) \{/);
assert.doesNotMatch(contentScript, /previousToolSummary|statusPlanningNextStep/);

const dialogGuardSource = sliceSource('function guardActiveDialogHostForPageTool()', 'async function getDialogStylesText()');
assert.doesNotMatch(dialogGuardSource, /removeChild/, 'run_js 執行期間不可把對話框移出 DOM，否則會閃爍且捲動位置歸零');
assert.match(dialogGuardSource, /!host\.isConnected && activeDialogState\?\.host === host/, '使用者已關閉的對話框不可被放回頁面');

// 以真正的 createExecutionTraceReporter() 模擬兩輪執行，驗證對話紀錄的順序與每輪思考列。
const history = [];
const traceSandbox = {
    ...sandbox,
    performance,
    conversationHistory: history,
    messagesEl: null,
    containsLocalizedMessageTemplate: () => false,
    isCompletionTraceMessage: (text) => text.startsWith('✅'),
    createApiTokenUsageAccumulator: () => ({}),
    getActiveMessagesElement: () => null,
    scrollActiveMessagesToBottom() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    renderAssistantMessageElement() {},
    appendMessage: () => ({ querySelector: () => ({ open: false }) }),
    addConversationTurn(role, content, displayContent, options = {}) {
        history.push({ role, content, displayContent, ...options });
    }
};
traceSandbox.appendPersistentMessage = (role, text, options = {}, historyOptions = {}) => {
    traceSandbox.addConversationTurn(role, text, text, { ...historyOptions, extraClassName: options.extraClassName });
};
vm.createContext(traceSandbox);
vm.runInContext(`
${sliceSource('function escapeHtml(', 'function getSafeMarkdownCodeLanguageClass(')}
${sliceSource('    function appendAgentTraceMessage(', '    function formatElapsedDuration(')}
${sliceSource('    function formatConversationStyleStatus(', '    const TOOL_TRACE_ICON_PATHS')}
${sliceSource('    const TOOL_TRACE_ICON_PATHS', '    function createExecutionTraceReporter(')}
${sliceSource('    function createExecutionTraceReporter()', '    function logAgentExecutionCompletion(')}
this.createExecutionTraceReporter = createExecutionTraceReporter;
`, traceSandbox);

const reporter = traceSandbox.createExecutionTraceReporter();
reporter.reportStatus('正在請 Google 規劃任務...');
reporter.reportReasoningDelta('先計算專案數量');
reporter.reportReasoning(['先計算專案數量']);
reporter.reportToolCalls([{ id: 'c1', name: 'run_js', args: { code: 'return 12' } }]);
reporter.reportToolResults([{ id: 'c1', name: 'run_js', result: { success: true, message: '已執行。' }, durationMs: 5 }]);
reporter.reportReasoningDelta('先計算專案數量');
traceSandbox.addConversationTurn('assistant', '共有 12 個專案。', '共有 12 個專案。');
reporter.reportCompletion('頁問已經打完收工');

assert.deepStrictEqual(
    history.map((turn) => turn.extraClassName?.match(/askpage-agent-trace-(\w+)$/)?.[1] || turn.content),
    ['status', 'reasoning', 'tool', 'reasoning', '共有 12 個專案。', 'completion'],
    '每輪各有一列思考（即使內容相同），且最後一輪的思考要排在回答之前'
);
assert.match(history[1].renderedHtml, /先計算專案數量/);
assert.match(history[2].renderedHtml, /data-state="success"/, '工具列在收到結果後就地改寫對話紀錄');

console.log('agent-tool-trace: ok');
