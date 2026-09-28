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
assert.match(pending.renderedHtml, /data-askpage-trace-id="tool-a-1"/);
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

const reasoningHtml = buildReasoningTraceHtml('trace-r-1', '先找出專案清單，\n\n再確認分頁。');
assert.match(reasoningHtml, /^<details class="askpage-tool-trace askpage-reasoning-trace" data-state="reasoning" data-askpage-trace-id="trace-r-1">/, '思考過程預設收合');
assert.match(reasoningHtml, />思考過程</);
assert.match(reasoningHtml, /<span class="askpage-tool-trace-summary">先找出專案清單， 再確認分頁。<\/span>/, '摘要壓成一行');
assert.match(reasoningHtml, /<div class="askpage-reasoning-trace-body"><p>先找出專案清單，/, '展開區保留完整的 Markdown 內容');

const reporterSource = sliceSource('    function createExecutionTraceReporter()', '    function logAgentExecutionCompletion(');
const reportToolResultsSource = reporterSource.slice(reporterSource.indexOf('reportToolResults('), reporterSource.indexOf('reportUsage('));
assert.match(reportToolResultsSource, /updateToolTraceMessage\(entry, toolResult\)/, '工具結果應就地更新同一列');
assert.doesNotMatch(reportToolResultsSource, /appendAgentTraceMessage/, '工具結果不可再另外新增一則訊息');
assert.match(reporterSource, /pendingToolTraces\.splice\(0\)\.forEach\(\(entry\) => updateToolTraceMessage\(entry, null, 'stopped'\)\)/);

const executeToolCallsSource = sliceSource('    async function executeToolCalls(', '    function getAssistantMessageText(');
assert.match(executeToolCallsSource, /durationMs: performance\.now\(\) - startedAt/);
assert.match(executeToolCallsSource, /results\.push\(timedToolResult\);\s*onToolResult\(timedToolResult\);/, '每個工具完成就要回報結果');
assert.strictEqual(
    (contentScript.match(/\(toolResult\) => onTrace\(\{ type: 'tool-result', round, toolResults: \[toolResult\] \}\)/g) || []).length,
    2,
    '兩個 tool loop 都要逐一回報工具結果'
);
assert.doesNotMatch(contentScript, /onTrace\(\{ type: 'tool-result', round, toolResults \}\)/, '不可等整批工具結束才回報');
assert.match(reporterSource, /reportToolCalls\(toolCalls\) \{[\s\S]*?finishStreamedReasoning\(\);/, '每輪工具呼叫前要結束這一輪的思考列');
assert.match(reporterSource, /reportCompletion\(message\) \{\s*finishStreamedReasoning\(\);/);
assert.match(reporterSource, /appendAgentTraceMessage\(`🧠 \$\{reasoningText\}`, 'reasoning', \{\s*renderedHtml: buildReasoningTraceHtml\(createTraceId\(\), reasoningText\)/);

assert.match(contentScript, /if \(!useTools \|\| round === 0\) \{/, '第二輪起不再顯示規劃狀態');
assert.match(contentScript, /if \(!enableTools \|\| round === 0\) \{/);
assert.doesNotMatch(contentScript, /previousToolSummary|statusPlanningNextStep/);

const dialogGuardSource = sliceSource('function guardActiveDialogHostForPageTool()', 'async function getDialogStylesText()');
assert.doesNotMatch(dialogGuardSource, /removeChild/, 'run_js 執行期間不可把對話框移出 DOM，否則會閃爍且捲動位置歸零');
assert.match(
    dialogGuardSource,
    /const isHostMisplaced = !host\.isConnected \|\| host\.parentNode !== parent;\s*if \(isHostMisplaced && activeDialogState\?\.host === host\)/,
    'host 被移除或被搬到其他父元素時要放回原位，但使用者已關閉的對話框不可被放回頁面'
);
assert.match(
    contentScript,
    /const shadowRoot = host\.attachShadow\(\{ mode: 'closed' \}\);/,
    '對話框必須使用 closed shadow root，主世界的 run_js 與頁面腳本才無法讀取或竄改對話內容'
);
assert.doesNotMatch(contentScript, /attachShadow\(\{ mode: 'open' \}\)/);
assert.doesNotMatch(
    sliceSource('function getActiveDialogShadowRoot()', 'function getActiveDialogElementById('),
    /host\?\.shadowRoot/,
    'closed shadow root 無法從 host.shadowRoot 取得，只能使用保留的參照'
);

// 以真正的 createExecutionTraceReporter() 模擬執行流程。訊息區以假物件代替：依 data-askpage-trace-id
// 查到的列會記錄每次重畫，藉此確認重畫的是「目前」的對話框，而不是舊的 DOM 參照。
// 每一列保留自己的 <details>；重畫時換成新的收合狀態物件，模擬 innerHTML 被整個改寫。
function createFakeMessages() {
    const renders = [];
    const rows = new Map();
    const getRow = (traceId) => {
        if (!rows.has(traceId)) {
            const row = { traceId, renders, details: { open: false } };
            row.querySelector = () => row.details;
            rows.set(traceId, row);
        }
        return rows.get(traceId);
    };
    return {
        renders,
        getRow,
        querySelector(selector) {
            const traceId = selector.match(/data-askpage-trace-id="([^"]+)"/)?.[1];
            return traceId ? { closest: () => getRow(traceId) } : null;
        }
    };
}

const history = [];
const pendingFrames = new Map();
let activeMessages = null;
const traceSandbox = {
    ...sandbox,
    performance,
    conversationHistory: history,
    messagesEl: null,
    containsLocalizedMessageTemplate: () => false,
    isCompletionTraceMessage: (text) => text.startsWith('✅'),
    createApiTokenUsageAccumulator: () => ({}),
    getActiveMessagesElement: () => activeMessages,
    scrollActiveMessagesToBottom() {},
    requestAnimationFrame(callback) {
        const frameId = pendingFrames.size + 1;
        pendingFrames.set(frameId, callback);
        return frameId;
    },
    cancelAnimationFrame(frameId) {
        pendingFrames.delete(frameId);
    },
    renderAssistantMessageElement(element, text) {
        element.renders.push({ traceId: element.traceId, text });
        element.details = { open: false };
    },
    appendMessage() {},
    addConversationTurn(role, content, displayContent, options = {}) {
        history.push({ role, content, displayContent, ...options });
    }
};
traceSandbox.appendPersistentMessage = (role, text, options = {}, historyOptions = {}) => {
    traceSandbox.addConversationTurn(role, text, text, { ...historyOptions, extraClassName: options.extraClassName });
};
const flushFrames = () => {
    const callbacks = [...pendingFrames.values()];
    pendingFrames.clear();
    callbacks.forEach((callback) => callback());
};
const traceKinds = () => history.map((turn) => turn.extraClassName?.match(/askpage-agent-trace-(\w+)$/)?.[1] || turn.content);
vm.createContext(traceSandbox);
vm.runInContext(`
${sliceSource('function escapeHtml(', 'function getSafeMarkdownCodeLanguageClass(')}
${sliceSource('    function appendAgentTraceMessage(', '    function formatElapsedDuration(')}
${sliceSource('    function formatConversationStyleStatus(', '    const TOOL_TRACE_ICON_PATHS')}
${sliceSource('    const TOOL_TRACE_ICON_PATHS', '    function createExecutionTraceReporter(')}
${sliceSource('    function createExecutionTraceReporter()', '    function logAgentExecutionCompletion(')}
this.createExecutionTraceReporter = createExecutionTraceReporter;
`, traceSandbox);

// 情境一：兩輪產生相同的思考內容，最後一輪的回答先存入紀錄。
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
    traceKinds(),
    ['status', 'reasoning', 'tool', 'reasoning', '共有 12 個專案。', 'completion'],
    '每輪各有一列思考（即使內容相同），且最後一輪的思考要排在回答之前'
);
assert.match(history[1].renderedHtml, /先計算專案數量/);
assert.match(history[2].renderedHtml, /data-state="success"/, '工具列在收到結果後就地改寫對話紀錄');

// 情境二：思考串流途中關閉再開啟對話框，後續內容要畫到新對話框中的那一列，對話紀錄也要是最新內容。
history.length = 0;
const firstDialog = createFakeMessages();
activeMessages = firstDialog;
const streamingReporter = traceSandbox.createExecutionTraceReporter();
streamingReporter.reportReasoningDelta('第一段');
flushFrames();
const reopenedDialog = createFakeMessages();
activeMessages = reopenedDialog;
streamingReporter.reportReasoningDelta('，第二段');
flushFrames();
assert.ok(firstDialog.renders.every((render) => !render.text.includes('第二段')), '不可再畫到已關閉的舊對話框');
assert.match(reopenedDialog.renders.at(-1)?.text || '', /第一段，第二段/, '重新開啟後的思考列要繼續更新');
assert.match(history[0].renderedHtml, /第一段，第二段/, '對話紀錄要隨串流保持最新');

// 情境三：同一批工具中途取消，已完成的工具保留結果，只有未完成的標為已中止。
history.length = 0;
activeMessages = null;
const cancelledReporter = traceSandbox.createExecutionTraceReporter();
cancelledReporter.reportToolCalls([
    { id: 'c1', name: 'read_page', args: { mode: 'text' } },
    { id: 'c2', name: 'run_js', args: { code: 'await new Promise(() => {})' } }
]);
cancelledReporter.reportToolResults([{ id: 'c1', name: 'read_page', result: { success: true, message: '已讀取。' }, durationMs: 8 }]);
cancelledReporter.reportCompletion('頁問提早收工');
assert.match(history[0].renderedHtml, /data-state="success"/, '已完成的工具不可被標為已中止');
assert.match(history[1].renderedHtml, /data-state="stopped"/);

// 情境四：使用者展開的列在重畫後仍維持展開（工具收到結果、思考持續串流）。
history.length = 0;
const expandDialog = createFakeMessages();
activeMessages = expandDialog;
const expandReporter = traceSandbox.createExecutionTraceReporter();
expandReporter.reportReasoningDelta('先想一下');
flushFrames();
const reasoningTraceId = expandDialog.renders.at(-1).traceId;
expandDialog.getRow(reasoningTraceId).details.open = true;
expandReporter.reportReasoningDelta('，再動手');
flushFrames();
assert.strictEqual(expandDialog.getRow(reasoningTraceId).details.open, true, '串流重畫後思考列仍要維持展開');
expandReporter.reportToolCalls([{ id: 'c1', name: 'run_js', args: { code: 'return 1' } }]);
const toolTraceId = history[1].renderedHtml.match(/data-askpage-trace-id="([^"]+)"/)[1];
expandDialog.getRow(toolTraceId).details.open = true;
expandReporter.reportToolResults([{ id: 'c1', name: 'run_js', result: { success: true, message: '完成' }, durationMs: 3 }]);
assert.ok(expandDialog.renders.some((render) => render.traceId === toolTraceId), '工具列收到結果時要重畫');
assert.strictEqual(expandDialog.getRow(toolTraceId).details.open, true, '工具列收到結果後仍要維持展開');
assert.strictEqual(expandDialog.getRow('never-opened').details.open, false);

console.log('agent-tool-trace: ok');
