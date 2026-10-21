'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    createElement,
    createDocument
} = require('./helpers/mock-dom');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const anthropicToolsModule = require('../lib/anthropic-tools.js');
const toolPolicyModule = require('../lib/tool-policy.js');

const body = createElement('body');
const documentRef = createDocument(body, 'Anthropic 工具測試頁');

// 工具定義放在 createDialog() 內，只能靠擷取原始碼在沙箱裡重建。
function sliceSource(startMarker, endMarker) {
    const start = contentScript.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `找不到 ${startMarker}`);
    const end = contentScript.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, `找不到 ${endMarker}`);
    return contentScript.slice(start, end);
}

const sandbox = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
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
        getComputedStyle(element) { return element.styleState; }
    },
    AGENT_READ_PAGE_DEFAULT_MAX_CHARS: 12000,
    AGENT_READ_PAGE_MAX_CHARS_LIMIT: 60000,
    AGENT_FIND_DEFAULT_LIMIT: 10,
    AGENT_FIND_MAX_LIMIT: 40,
    AskPageAnthropicTools: anthropicToolsModule,
    AskPageToolPolicy: toolPolicyModule,
    globalThis: null
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`
${sliceSource('    function getToolDefinitions()', '    function normalizeOllamaCloudWebSearchMaxResults(')}
${sliceSource('    function getToolDefinitionsForRequest(', '    function getOpenAIToolDefinitions(')}
${sliceSource('    function getAnthropicToolDefinitions(', '    function getOpenAIToolDefinitions(')}
this.getToolDefinitionsForRequest = getToolDefinitionsForRequest;
this.getAnthropicToolDefinitions = getAnthropicToolDefinitions;
`, sandbox, { filename: 'content.js' });

const {
    getAnthropicToolDefinitions,
    getToolDefinitionsForRequest
} = sandbox;

const {
    createAnthropicStreamAccumulator,
    buildAnthropicToolResultBlock,
    buildAnthropicThinkingBlocks,
    buildAnthropicAssistantBlocks,
    parseAnthropicToolInput,
    getAnthropicStopReason
} = anthropicToolsModule;

const plain = (value) => JSON.parse(JSON.stringify(value));

// ===== 工具定義轉換：Anthropic 用 input_schema，不是 parameters =====
const anthropicTools = plain(getAnthropicToolDefinitions());
assert.ok(anthropicTools.length > 0, '應有可用的頁面工具');
anthropicTools.forEach((tool) => {
    assert.ok(tool.name, '工具應有名稱');
    assert.ok(tool.description, `${tool.name} 應有說明`);
    assert.ok(tool.input_schema, `${tool.name} 應有 input_schema`);
    assert.strictEqual(tool.input_schema.type, 'object', `${tool.name} 的 input_schema 應是 object`);
    assert.ok(tool.input_schema.properties, `${tool.name} 的 input_schema 應有 properties`);
    assert.strictEqual(tool.parameters, undefined, 'Anthropic 工具定義不可帶 parameters');
    assert.strictEqual(tool.type, undefined, 'Anthropic 工具定義不需要 type 欄位');
    assert.match(tool.name, /^[a-zA-Z0-9_-]{1,128}$/, `${tool.name} 應符合 Anthropic 的工具名稱格式`);
});

const sourceTools = plain(getToolDefinitionsForRequest());
assert.strictEqual(anthropicTools.length, sourceTools.length, '轉換後的工具數量應一致');
assert.strictEqual(
    anthropicTools.map((tool) => tool.name).join(','),
    sourceTools.map((tool) => tool.name).join(','),
    '工具順序與名稱應與來源一致'
);
assert.match(anthropicTools[0].description, /^\[tool-risk: /, '風險標註應與其他 provider 一致');

// 關閉頁面工具時不應帶任何工具定義。
assert.deepStrictEqual(plain(getAnthropicToolDefinitions({ includePageTools: false })), [], '非代理模式不應附上工具');

// ===== 串流事件累積：tool_use 與 thinking block =====
const accumulator = createAnthropicStreamAccumulator();
accumulator.handleEvent({ type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-4-6', usage: { input_tokens: 10 } } });
accumulator.handleEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
accumulator.handleEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先確認頁面結構' } });
accumulator.handleEvent({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } });
accumulator.handleEvent({ type: 'content_block_start', index: 1, content_block: { type: 'text' } });
accumulator.handleEvent({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '我先讀取頁面。' } });
accumulator.handleEvent({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_page' } });
accumulator.handleEvent({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"mode":"tex' } });
accumulator.handleEvent({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 't"}' } });
accumulator.handleEvent({ type: 'content_block_stop', index: 2 });
accumulator.handleEvent({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } });

const blocks = plain(accumulator.getContentBlocks());
assert.strictEqual(blocks.length, 3, '應累積 thinking、text 與 tool_use 三個 block');
assert.deepStrictEqual(blocks[0], { type: 'thinking', thinking: '先確認頁面結構', signature: 'sig-abc' }, 'thinking block 要保留文字與簽章');
assert.deepStrictEqual(blocks[1], { type: 'text', text: '我先讀取頁面。' });
assert.deepStrictEqual(blocks[2], { type: 'tool_use', id: 'toolu_1', name: 'read_page', input: { mode: 'text' } }, 'input_json_delta 應累積成 JSON 物件');
assert.strictEqual(accumulator.getText(), '我先讀取頁面。', '答案文字只取 text block');
assert.strictEqual(accumulator.getStopReason(), 'tool_use');
assert.deepStrictEqual(plain(accumulator.getUsage()), { output_tokens: 42 }, 'message_delta 的 usage 應覆蓋 message_start');

// 空的 input_json_delta 也要能解析成空物件。
const emptyAccumulator = createAnthropicStreamAccumulator();
emptyAccumulator.handleEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_2', name: 'get_page_metadata' } });
emptyAccumulator.handleEvent({ type: 'content_block_stop', index: 0 });
assert.deepStrictEqual(plain(emptyAccumulator.getContentBlocks()), [
    { type: 'tool_use', id: 'toolu_2', name: 'get_page_metadata', input: {} }
], '沒有參數的工具呼叫應解析成空物件');

// 壞掉的 JSON 參數要保留原文，讓執行層回報解析失敗。
const brokenAccumulator = createAnthropicStreamAccumulator();
brokenAccumulator.handleEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_3', name: 'click' } });
brokenAccumulator.handleEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{not json' } });
const brokenBlock = plain(brokenAccumulator.getContentBlocks()[0]);
assert.ok(brokenBlock.input._parseError, '壞掉的 JSON 應帶上 _parseError');
assert.strictEqual(brokenBlock.input._raw, '{not json');

// ===== thinking block 保留 =====
const thinkingBlocks = plain(buildAnthropicThinkingBlocks([
    { type: 'thinking', thinking: '推理內容', signature: 'sig-1' },
    { type: 'redacted_thinking', data: 'redacted-payload' },
    { type: 'text', text: '不屬於 thinking' },
    { type: 'tool_use', id: 'toolu_1', name: 'read_page', input: {} }
]));
assert.deepStrictEqual(thinkingBlocks, [
    { type: 'thinking', thinking: '推理內容', signature: 'sig-1' },
    { type: 'redacted_thinking', data: 'redacted-payload' }
], '只保留 thinking 與 redacted_thinking block');

// assistant 訊息要保留 thinking、text 與 tool_use 的原始順序。
const assistantBlocks = plain(buildAnthropicAssistantBlocks([
    { type: 'thinking', thinking: '推理內容', signature: 'sig-1' },
    { type: 'text', text: '我先讀取頁面。' },
    { type: 'tool_use', id: 'toolu_1', name: 'read_page', input: { mode: 'text' } }
]));
assert.deepStrictEqual(assistantBlocks.map((block) => block.type), ['thinking', 'text', 'tool_use'], 'block 順序不可改變');
assert.deepStrictEqual(assistantBlocks[0], { type: 'thinking', thinking: '推理內容', signature: 'sig-1' });
assert.deepStrictEqual(assistantBlocks[2], { type: 'tool_use', id: 'toolu_1', name: 'read_page', input: { mode: 'text' } });

// ===== 停止原因：串流與非串流的欄位位置不同 =====
assert.strictEqual(getAnthropicStopReason({ stopReason: 'max_tokens' }), 'max_tokens', '串流回應的 stop_reason');
assert.strictEqual(getAnthropicStopReason({ stop_reason: 'tool_use' }), 'tool_use', '非串流回應的 stop_reason');
assert.strictEqual(getAnthropicStopReason(null), '');
assert.strictEqual(getAnthropicStopReason({}), '');

// ===== 工具結果回傳格式 =====
const toolResultBlock = plain(buildAnthropicToolResultBlock({
    id: 'toolu_1',
    name: 'read_page',
    result: { success: true, message: '已讀取。', data: { text: '內容' } }
}));
assert.strictEqual(toolResultBlock.type, 'tool_result');
assert.strictEqual(toolResultBlock.tool_use_id, 'toolu_1', 'tool_result 要用 tool_use_id 對應工具呼叫');
assert.strictEqual(toolResultBlock.is_error, false);
const parsedToolResult = JSON.parse(toolResultBlock.content);
assert.strictEqual(parsedToolResult.success, true);
assert.strictEqual(parsedToolResult.data.text, '內容', '工具結果應保留資料內容');

const failedToolResultBlock = plain(buildAnthropicToolResultBlock({
    id: 'toolu_2',
    name: 'click',
    result: { success: false, message: '找不到目標。' }
}));
assert.strictEqual(failedToolResultBlock.is_error, true, '失敗的工具結果要標記 is_error');

// ===== 參數解析 =====
assert.deepStrictEqual(plain(parseAnthropicToolInput('{"ref":"e12"}')), { ref: 'e12' });
assert.deepStrictEqual(plain(parseAnthropicToolInput({ ref: 'e12' })), { ref: 'e12' });
assert.deepStrictEqual(plain(parseAnthropicToolInput(null)), {});
assert.deepStrictEqual(plain(parseAnthropicToolInput('[1,2]')), {}, '陣列不是合法的工具參數');

// ===== 工具迴圈：模型呼叫工具 → 執行 → 回傳結果 → 取得最終答案 =====
(async () => {
const loopSandbox = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    getLocalizedText: (key) => key,
    AskPageAnthropicTools: anthropicToolsModule,
    getToolCallMaxRounds: async () => 5,
    throwIfAskTaskCancelled() {},
    formatRoundStatus: (round, message) => message,
    formatToolDisplayName: (name) => name || '未知工具',
    formatToolNameList: (names) => names.join(', '),
    parseToolArguments: (raw) => anthropicToolsModule.parseAnthropicToolInput(raw),
    isLikelyToolUnsupportedError: () => false,
    buildAnthropicThinkingBlocks: anthropicToolsModule.buildAnthropicThinkingBlocks,
    buildAnthropicAssistantBlocks: anthropicToolsModule.buildAnthropicAssistantBlocks,
    buildAnthropicToolResultBlock: anthropicToolsModule.buildAnthropicToolResultBlock,
    globalThis: null
};
loopSandbox.globalThis = loopSandbox;
vm.createContext(loopSandbox);
vm.runInContext(`
${sliceSource('    async function runAnthropicToolLoop(', '    async function askAnthropic(')}
this.runAnthropicToolLoop = runAnthropicToolLoop;
`, loopSandbox, { filename: 'content.js' });

const { runAnthropicToolLoop } = loopSandbox;

const executedToolCalls = [];
const executeToolCallsStub = async (toolCalls, onToolStatus, toolContext, onToolResult) => {
    const results = [];
    for (const [index, toolCall] of toolCalls.entries()) {
        onToolStatus({ name: toolCall.name, index: index + 1, total: toolCalls.length });
        executedToolCalls.push(toolCall);
        const timedToolResult = {
            id: toolCall.id,
            name: toolCall.name,
            durationMs: 5,
            result: { success: true, message: `已執行 ${toolCall.name}`, data: { ref: toolCall.args?.ref || '' } }
        };
        results.push(timedToolResult);
        onToolResult(timedToolResult);
    }
    return results;
};
// executeToolCalls 是迴圈內呼叫的外部函式，重新掛回沙箱。
loopSandbox.executeToolCalls = executeToolCallsStub;

const requestBodies = [];
const responses = [
    {
        content: [
            { type: 'thinking', thinking: '先找按鈕', signature: 'sig-round-1' },
            { type: 'text', text: '我先找出登入按鈕。' },
            { type: 'tool_use', id: 'toolu_1', name: 'find', input: { text: '登入' } }
        ],
        usage: { input_tokens: 10, output_tokens: 5 }
    },
    {
        content: [
            { type: 'thinking', thinking: '找到 ref 了', signature: 'sig-round-2' },
            { type: 'text', text: '已找到登入按鈕，位於頁首。' }
        ],
        usage: { input_tokens: 20, output_tokens: 8 }
    }
];

const statuses = [];
const traceEvents = [];
const loopResult = await runAnthropicToolLoop({
    providerLabel: 'Anthropic',
    initialMessages: [{ role: 'user', content: '幫我找登入按鈕' }],
    initialUseTools: true,
    onStatusUpdate: (status) => statuses.push(status),
    onTrace: (event) => traceEvents.push(event),
    buildRequestBody: (messages, useTools) => {
        const body = { model: 'claude-sonnet-4-6', messages, max_tokens: 4096 };
        if (useTools) {
            body.tools = anthropicToolsModule.buildAnthropicToolDefinitions([{ name: 'find', description: '找元素', parameters: { type: 'object', properties: {} } }]);
        }
        requestBodies.push(body);
        return body;
    },
    sendRequest: async () => responses.shift()
});

assert.strictEqual(loopResult.answer, '已找到登入按鈕，位於頁首。', '最終答案應取最後一輪的文字');
assert.strictEqual(loopResult.fallbackUsed, false);
assert.strictEqual(executedToolCalls.length, 1, '應執行一次工具');
assert.deepStrictEqual(plain(executedToolCalls[0]), { id: 'toolu_1', name: 'find', args: { text: '登入' } }, '工具參數要正確解析');

assert.strictEqual(requestBodies.length, 2, '應送出兩次請求');
assert.ok(requestBodies[0].tools, '第一輪要帶上工具定義');
assert.ok(requestBodies[1].tools, '第二輪仍要帶上工具定義');

// 第二輪的訊息必須包含 assistant 的 thinking 與 tool_use，以及 user 的 tool_result。
const secondRoundMessages = plain(requestBodies[1].messages);
assert.strictEqual(secondRoundMessages.length, 3, '應有使用者訊息、助理訊息與工具結果');
assert.strictEqual(secondRoundMessages[1].role, 'assistant');
assert.deepStrictEqual(
    secondRoundMessages[1].content.map((block) => block.type),
    ['thinking', 'text', 'tool_use'],
    '助理訊息要保留 thinking、text 與 tool_use 的順序'
);
assert.deepStrictEqual(
    secondRoundMessages[1].content[0],
    { type: 'thinking', thinking: '先找按鈕', signature: 'sig-round-1' },
    'thinking block 必須原封不動回傳'
);
assert.deepStrictEqual(secondRoundMessages[1].content[2], { type: 'tool_use', id: 'toolu_1', name: 'find', input: { text: '登入' } });

assert.strictEqual(secondRoundMessages[2].role, 'user', '工具結果要以 user 訊息送回');
assert.strictEqual(secondRoundMessages[2].content.length, 1);
assert.strictEqual(secondRoundMessages[2].content[0].type, 'tool_result');
assert.strictEqual(secondRoundMessages[2].content[0].tool_use_id, 'toolu_1', 'tool_result 要對應工具呼叫 id');
const roundTripResult = JSON.parse(secondRoundMessages[2].content[0].content);
assert.strictEqual(roundTripResult.success, true);
assert.strictEqual(roundTripResult.data.ref, '', '工具結果內容要完整保留');

assert.ok(statuses.some((status) => status === 'statusToolSelected'), '應回報工具選取狀態');
assert.ok(statuses.some((status) => status === 'statusToolExecuting'), '應回報工具執行狀態');
assert.ok(statuses.some((status) => status === 'statusToolResults'), '應回報工具結果狀態');
assert.ok(traceEvents.some((event) => event.type === 'tool-call'), '應送出 tool-call 追蹤');
assert.ok(traceEvents.some((event) => event.type === 'tool-result'), '應送出 tool-result 追蹤');
assert.ok(traceEvents.some((event) => event.type === 'usage'), '應送出 usage 追蹤');

// 非代理模式不應帶上工具定義。
const plainRequestBodies = [];
await runAnthropicToolLoop({
    providerLabel: 'Anthropic',
    initialMessages: [{ role: 'user', content: '嗨' }],
    initialUseTools: false,
    buildRequestBody: (messages, useTools) => {
        const body = { model: 'claude-sonnet-4-6', messages };
        if (useTools) {
            body.tools = [];
        }
        plainRequestBodies.push(body);
        return body;
    },
    sendRequest: async () => ({ content: [{ type: 'text', text: '你好' }], usage: {} })
});
assert.strictEqual(plainRequestBodies[0].tools, undefined, '非代理模式不應附上工具定義');

// 缺少 id 的 tool_use 區塊無法對應 tool_result，應直接回報格式錯誤。
let malformedError = null;
try {
    await runAnthropicToolLoop({
        providerLabel: 'Anthropic',
        initialMessages: [{ role: 'user', content: '嗨' }],
        initialUseTools: true,
        buildRequestBody: (messages) => ({ model: 'claude-sonnet-4-6', messages }),
        sendRequest: async () => ({
            content: [{ type: 'tool_use', id: '', name: 'find', input: {} }],
            usage: {}
        })
    });
} catch (error) {
    malformedError = error;
}
assert.ok(malformedError, '缺少 id 的工具呼叫應拋出錯誤');
assert.strictEqual(malformedError.message, 'anthropicMalformedToolCall', '應回報格式不正確的工具呼叫');

// 達到輸出上限時要回報輸出長度上限，而不是籠統的空白回應。
let outputLimitError = null;
try {
    await runAnthropicToolLoop({
        providerLabel: 'Anthropic',
        initialMessages: [{ role: 'user', content: '嗨' }],
        initialUseTools: true,
        buildRequestBody: (messages) => ({ model: 'claude-sonnet-4-6', messages }),
        sendRequest: async () => ({
            content: [],
            stopReason: 'max_tokens',
            usage: {}
        })
    });
} catch (error) {
    outputLimitError = error;
}
assert.ok(outputLimitError, '達到輸出上限時應拋出錯誤');
assert.strictEqual(outputLimitError.message, 'anthropicOutputLimit', '應回報輸出長度上限');

console.log('anthropic-tool-loop: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
