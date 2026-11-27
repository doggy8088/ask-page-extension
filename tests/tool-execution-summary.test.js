'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'src', 'content.js'), 'utf8');

function sliceSource(startMarker, endMarker) {
    const start = contentScript.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `找不到 ${startMarker}`);
    const end = contentScript.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, `找不到 ${endMarker}`);
    return contentScript.slice(start, end);
}

// 1. 摘要只記工具名稱、成敗與結果訊息，並壓縮長度與則數。
const summarySandbox = { console };
vm.createContext(summarySandbox);
vm.runInContext(`
${sliceSource('const TOOL_SUMMARY_MAX_ENTRIES = 12;', 'function buildTextProviderTurnMessage(')}
this.buildToolExecutionSummary = buildToolExecutionSummary;
`, summarySandbox);

const { buildToolExecutionSummary } = summarySandbox;
const summary = buildToolExecutionSummary([
    { name: 'run_js', result: { success: true, message: '已執行 2 行腳本。\n結果：12' } },
    { name: 'click', result: { success: false, message: '找不到符合的元素' } }
]);
assert.strictEqual(
    summary,
    '[Tool execution summary]\n- run_js: success - 已執行 2 行腳本。 結果：12\n- click: failed - 找不到符合的元素',
    '摘要要把結果訊息壓成一行並標記成敗'
);
assert.doesNotMatch(summary, /tool_call|call_id|ref: e\d+/, '摘要不可帶 tool_call id 或頁面 ref');

assert.strictEqual(buildToolExecutionSummary([]), '');
assert.strictEqual(buildToolExecutionSummary(null), '');
assert.strictEqual(buildToolExecutionSummary([{ result: {} }, { name: '' }]), '', '沒有工具名稱的項目不列入摘要');

const longMessage = 'x'.repeat(500);
const truncatedLine = buildToolExecutionSummary([{ name: 'read_page', result: { success: true, message: longMessage } }])
    .split('\n')[1];
assert.ok(truncatedLine.endsWith(`${'x'.repeat(200)}...`), '單筆結果訊息超過 200 字要截斷');

const manyResults = Array.from({ length: 20 }, (unused, index) => ({
    name: `tool${index}`,
    result: { success: true, message: `r${index}` }
}));
const cappedSummary = buildToolExecutionSummary(manyResults);
assert.strictEqual(cappedSummary.split('\n').length, 13, '摘要最多保留 12 筆工具結果');
assert.match(cappedSummary, /tool19/);
assert.doesNotMatch(cappedSummary, /tool7:/, '超出上限的舊結果要捨棄');

// 2. 摘要以 assistant 回合的模型內容送出，UI 顯示內容不變。
const builderSandbox = {
    console,
    buildTextProviderUserContent: (content) => content
};
vm.createContext(builderSandbox);
vm.runInContext(`
${sliceSource('function buildTextProviderTurnMessage(', 'function buildGeminiTurnSteps(')}
this.buildTextProviderTurnMessage = buildTextProviderTurnMessage;
this.buildAnthropicTurnMessage = buildAnthropicTurnMessage;
`, builderSandbox);

const { buildTextProviderTurnMessage, buildAnthropicTurnMessage } = builderSandbox;
assert.strictEqual(
    buildTextProviderTurnMessage({ role: 'assistant', content: '答案', toolSummary: summary }).content,
    `答案\n\n${summary}`,
    'OpenAI 風格回合要把摘要接在答案後'
);
assert.strictEqual(
    buildTextProviderTurnMessage({ role: 'assistant', content: '答案' }).content,
    '答案'
);
assert.strictEqual(
    buildTextProviderTurnMessage({ role: 'user', content: '問題', toolSummary: summary }).content,
    '問題',
    '摘要只掛在 assistant 回合'
);

const anthropicBlocks = [
    { type: 'thinking', thinking: '思考', signature: 'sig' },
    { type: 'text', text: '答案' }
];
const anthropicMessage = buildAnthropicTurnMessage({
    role: 'assistant',
    content: '答案',
    anthropicBlocks,
    toolSummary: summary
});
// 沙箱建立的是另一個 realm 的物件，比較前先轉成純值。
const plainAnthropicContent = JSON.parse(JSON.stringify(anthropicMessage.content));
assert.deepStrictEqual(
    plainAnthropicContent,
    [...anthropicBlocks, { type: 'text', text: summary }],
    'Anthropic 回合要在既有 blocks 後補一個純文字摘要區塊'
);
assert.strictEqual(anthropicBlocks.length, 2, '原始 blocks 不可被改動');
assert.strictEqual(
    buildAnthropicTurnMessage({ role: 'assistant', content: '答案', anthropicBlocks }).content,
    anthropicBlocks
);

// 3. 對話紀錄要保存摘要，且沒有摘要時不留下空欄位。
const history = [];
const turnSandbox = {
    console,
    conversationHistory: history,
    normalizeInputImageDataUrls: (value) => Array.isArray(value) ? value : [],
    refreshClearConversationButton() {}
};
vm.createContext(turnSandbox);
vm.runInContext(`
${sliceSource('function addConversationTurn(', 'function truncateConversationFromTurn(')}
this.addConversationTurn = addConversationTurn;
`, turnSandbox);

turnSandbox.addConversationTurn('assistant', '答案', '答案', { toolSummary: summary });
assert.strictEqual(history[0].toolSummary, summary);
turnSandbox.addConversationTurn('assistant', '答案', '答案');
assert.ok(!('toolSummary' in history[1]), '沒有工具執行時不要保存空摘要');

// 4. 兩個會丟棄工具軌跡的迴圈要累積結果並回傳摘要；Gemini 仍以 steps 保存。
assert.strictEqual(
    (contentScript.match(/executedToolResults\.push\(\.\.\.toolResults\);/g) || []).length,
    2,
    'OpenAI 風格與 Anthropic 迴圈都要累積工具結果'
);
assert.strictEqual(
    (contentScript.match(/toolSummary: buildToolExecutionSummary\(executedToolResults\)/g) || []).length,
    2,
    '兩個迴圈都要回傳工具摘要'
);
assert.strictEqual(
    (contentScript.match(/toolSummary: answer\.toolSummary/g) || []).length,
    8,
    '四個 provider 路徑的串流與非串流寫入都要帶上摘要'
);
assert.match(contentScript, /streamedAnswer\.finalize\(answer, \{ geminiSteps \}\)/, 'Gemini 仍以 steps 跨輪保留工具軌跡');
assert.doesNotMatch(
    sliceSource('    async function runGeminiToolLoop(', '    async function askGemini('),
    /buildToolExecutionSummary/,
    'Gemini 已有 steps，不需再重複摘要'
);

console.log('tool-execution-summary: ok');
