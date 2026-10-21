'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const settingsHtml = fs.readFileSync(path.join(rootDir, 'settings.html'), 'utf8');
const settingsScript = fs.readFileSync(path.join(rootDir, 'settings.js'), 'utf8');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const anthropicToolsModule = require('../lib/anthropic-tools.js');

const plain = (value) => JSON.parse(JSON.stringify(value));

// ===== 設定頁：Anthropic 的原生網路搜尋開關 =====
assert.match(settingsHtml, /id="modalAnthropicWebSearch"/);
assert.match(
    settingsHtml,
    /https:\/\/platform\.claude\.com\/docs\/en\/agents-and-tools\/tool-use\/web-search-tool/
);
assert.match(settingsScript, /modalAnthropicWebSearch\.checked = !!provider\.webSearchEnabled/);
assert.match(settingsScript, /providerData\.webSearchEnabled = modalAnthropicWebSearch\.checked/);

// ===== 請求：搜尋工具與頁面工具依模式分開加入 =====
assert.match(contentScript, /const anthropicWebSearchEnabled = !!activeConfig\?\.webSearchEnabled;/);
assert.match(contentScript, /initialUseTools: agentModeEnabled \|\| anthropicWebSearchEnabled/);
assert.match(contentScript, /includePageTools: agentModeEnabled/);
assert.match(contentScript, /tools\.push\(buildAnthropicWebSearchTool\(\)\)/);
assert.match(contentScript, /onServerToolUse:/);
assert.match(contentScript, /stopReason === 'pause_turn'/);
assert.match(contentScript, /appendAnthropicWebSearchSources\(answer\.answer, answer\.citations\)/);
assert.match(contentScript, /textBlock\.citations = item\.citations;/, '跨輪對話要保留 citations');

// ===== 工具定義：Anthropic server tool 的格式 =====
assert.deepStrictEqual(plain(anthropicToolsModule.buildAnthropicWebSearchTool()), {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5
});
assert.strictEqual(
    anthropicToolsModule.buildAnthropicWebSearchTool({ maxUses: 2 }).max_uses,
    2,
    '應允許自訂搜尋次數上限'
);
assert.strictEqual(
    anthropicToolsModule.buildAnthropicWebSearchTool({ maxUses: 0 }).max_uses,
    5,
    '無效的搜尋次數上限應回到預設值'
);

// ===== 串流：保留 server_tool_use、搜尋結果與 citations =====
const encryptedContent = 'encrypted-search-content';
const encryptedIndex = 'encrypted-citation-index';
const accumulator = anthropicToolsModule.createAnthropicStreamAccumulator();
accumulator.handleEvent({
    type: 'message_start',
    message: { id: 'msg_search', model: 'claude-sonnet-5-5', usage: { input_tokens: 10 } }
});
accumulator.handleEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
});
accumulator.handleEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: '我會先搜尋。' }
});
accumulator.handleEvent({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' }
});
accumulator.handleEvent({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"query":"claude shannon"}' }
});
accumulator.handleEvent({
    type: 'content_block_start',
    index: 2,
    content_block: {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_1',
        content: [{
            type: 'web_search_result',
            url: 'https://example.com/claude-shannon',
            title: 'Claude Shannon',
            encrypted_content: encryptedContent,
            page_age: 'April 30, 2025'
        }]
    }
});
accumulator.handleEvent({
    type: 'content_block_start',
    index: 3,
    content_block: { type: 'text', text: '' }
});
accumulator.handleEvent({
    type: 'content_block_delta',
    index: 3,
    delta: { type: 'text_delta', text: 'Claude Shannon 出生於 1916 年。' }
});
accumulator.handleEvent({
    type: 'content_block_delta',
    index: 3,
    delta: {
        type: 'citations_delta',
        citation: {
            type: 'web_search_result_location',
            url: 'https://example.com/claude-shannon',
            title: 'Claude Shannon',
            encrypted_index: encryptedIndex,
            cited_text: 'Claude Shannon was born in 1916.'
        }
    }
});
accumulator.handleEvent({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 20, server_tool_use: { web_search_requests: 1 } }
});

const streamedBlocks = plain(accumulator.getContentBlocks());
assert.strictEqual(streamedBlocks.length, 4, '應保留四個 content block');
assert.deepStrictEqual(streamedBlocks[1], {
    type: 'server_tool_use',
    id: 'srvtoolu_1',
    name: 'web_search',
    input: { query: 'claude shannon' }
}, 'server_tool_use 要保留 id、名稱與查詢參數');
assert.deepStrictEqual(streamedBlocks[2], {
    type: 'web_search_tool_result',
    tool_use_id: 'srvtoolu_1',
    content: [{
        type: 'web_search_result',
        url: 'https://example.com/claude-shannon',
        title: 'Claude Shannon',
        encrypted_content: encryptedContent,
        page_age: 'April 30, 2025'
    }]
}, '搜尋結果與 encrypted_content 必須原樣保留');
assert.strictEqual(streamedBlocks[3].text, 'Claude Shannon 出生於 1916 年。');
assert.deepStrictEqual(streamedBlocks[3].citations, [{
    type: 'web_search_result_location',
    url: 'https://example.com/claude-shannon',
    title: 'Claude Shannon',
    encrypted_index: encryptedIndex,
    cited_text: 'Claude Shannon was born in 1916.'
}], 'text block 要保留 citations 與 encrypted_index');
assert.deepStrictEqual(plain(accumulator.getUsage()), {
    output_tokens: 20,
    server_tool_use: { web_search_requests: 1 }
});
assert.strictEqual(accumulator.getStopReason(), 'end_turn');

// assistant 訊息回傳時，搜尋結果與 citations 不可被改寫。
const assistantBlocks = plain(anthropicToolsModule.buildAnthropicAssistantBlocks(streamedBlocks));
assert.deepStrictEqual(assistantBlocks, streamedBlocks, 'assistant blocks 應完整保留搜尋結果與來源');

// 來源清單依 URL 去重。
const citations = plain(anthropicToolsModule.collectAnthropicWebSearchCitations([
    ...streamedBlocks,
    {
        type: 'text',
        text: '重複引用',
        citations: [{
            type: 'web_search_result_location',
            url: 'https://example.com/claude-shannon',
            title: '重複來源'
        }]
    }
]));
assert.deepStrictEqual(citations, [{
    url: 'https://example.com/claude-shannon',
    title: 'Claude Shannon'
}]);

// ===== 工具迴圈：pause_turn 要原樣送回 assistant 內容並續跑 =====
function sliceSource(startMarker, endMarker) {
    const start = contentScript.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `找不到 ${startMarker}`);
    const end = contentScript.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, `找不到 ${endMarker}`);
    return contentScript.slice(start, end);
}

const loopSandbox = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    getLocalizedText: (key) => key,
    AskPageAnthropicTools: anthropicToolsModule,
    getToolCallMaxRounds: async () => 10,
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
${sliceSource('    function buildAnthropicWebSearchTool()', '    async function askAnthropic(')}
this.runAnthropicToolLoop = runAnthropicToolLoop;
`, loopSandbox, { filename: 'content.js' });

const { runAnthropicToolLoop } = loopSandbox;
const webSearchTool = anthropicToolsModule.buildAnthropicWebSearchTool();

(async () => {
const pauseBodies = [];
const pauseResponses = [
    {
        content: [
            { type: 'text', text: '我會先搜尋。' },
            { type: 'server_tool_use', id: 'srvtoolu_pause', name: 'web_search', input: { query: 'query' } }
        ],
        stop_reason: 'pause_turn'
    },
    {
        content: [
            {
                type: 'web_search_tool_result',
                tool_use_id: 'srvtoolu_pause',
                content: [{
                    type: 'web_search_result',
                    url: 'https://example.com/result',
                    title: 'Result',
                    encrypted_content: encryptedContent
                }]
            },
            {
                type: 'text',
                text: '搜尋完成。',
                citations: [{
                    type: 'web_search_result_location',
                    url: 'https://example.com/result',
                    title: 'Result',
                    encrypted_index: encryptedIndex
                }]
            }
        ],
        stop_reason: 'end_turn'
    }
];
const pauseStatuses = [];
const pauseResult = await runAnthropicToolLoop({
    providerLabel: 'Anthropic',
    initialMessages: [{ role: 'user', content: '搜尋最新資訊' }],
    initialUseTools: true,
    onStatusUpdate: (status) => pauseStatuses.push(status),
    buildRequestBody: (messages, useTools) => {
        const body = { model: 'claude-sonnet-5-5', messages, max_tokens: 4096 };
        if (useTools) {
            body.tools = [webSearchTool];
        }
        pauseBodies.push(body);
        return body;
    },
    sendRequest: async () => pauseResponses.shift()
});

assert.strictEqual(pauseBodies.length, 2, 'pause_turn 應觸發第二次請求');
assert.deepStrictEqual(
    plain(pauseBodies[1].messages[1]),
    {
        role: 'assistant',
        content: [
            { type: 'text', text: '我會先搜尋。' },
            { type: 'server_tool_use', id: 'srvtoolu_pause', name: 'web_search', input: { query: 'query' } }
        ]
    },
    '續跑時 assistant 內容必須原樣送回'
);
assert.deepStrictEqual(plain(pauseBodies[1].tools), [webSearchTool], '續跑時必須保留相同的搜尋工具');
assert.strictEqual(pauseResult.answer, '搜尋完成。');
assert.deepStrictEqual(plain(pauseResult.citations), [{
    url: 'https://example.com/result',
    title: 'Result'
}]);
assert.deepStrictEqual(
    plain(pauseResult.assistantBlocks).map((block) => block.type),
    ['server_tool_use', 'web_search_tool_result', 'text'],
    '最終回合要保留搜尋結果區塊，並補回對應的 server_tool_use'
);
assert.strictEqual(
    pauseResult.assistantBlocks[0].id,
    'srvtoolu_pause',
    '補回的 server_tool_use id 要與搜尋結果配對'
);
assert.ok(
    pauseStatuses.includes('statusAnthropicWebSearch'),
    'pause_turn 應回報網路搜尋狀態'
);

// ===== 工具迴圈：伺服器搜尋與頁面工具可同時存在 =====
loopSandbox.executeToolCalls = async (toolCalls, onToolStatus, toolContext, onToolResult) => {
    const results = [];
    for (const [index, toolCall] of toolCalls.entries()) {
        onToolStatus({ name: toolCall.name, index: index + 1, total: toolCalls.length });
        const result = {
            id: toolCall.id,
            name: toolCall.name,
            durationMs: 1,
            result: { success: true, message: '已執行', data: {} }
        };
        results.push(result);
        onToolResult(result);
    }
    return results;
};

const mixedBodies = [];
const mixedResponses = [
    {
        content: [
            { type: 'server_tool_use', id: 'srvtoolu_mixed', name: 'web_search', input: { query: 'query' } },
            { type: 'tool_use', id: 'toolu_mixed', name: 'find', input: { text: '目標' } }
        ],
        stop_reason: 'tool_use'
    },
    {
        content: [
            {
                type: 'web_search_tool_result',
                tool_use_id: 'srvtoolu_mixed',
                content: [{
                    type: 'web_search_result',
                    url: 'https://example.com/mixed',
                    title: 'Mixed',
                    encrypted_content: encryptedContent
                }]
            },
            {
                type: 'text',
                text: '已完成搜尋與頁面操作。',
                citations: [{
                    type: 'web_search_result_location',
                    url: 'https://example.com/mixed',
                    title: 'Mixed',
                    encrypted_index: encryptedIndex
                }]
            }
        ],
        stop_reason: 'end_turn'
    }
];
const mixedResult = await runAnthropicToolLoop({
    providerLabel: 'Anthropic',
    initialMessages: [{ role: 'user', content: '搜尋並操作頁面' }],
    initialUseTools: true,
    buildRequestBody: (messages, useTools) => {
        const body = {
            model: 'claude-sonnet-5-5',
            messages,
            max_tokens: 4096,
            tools: useTools
                ? [
                    anthropicToolsModule.buildAnthropicToolDefinitions([{
                        name: 'find',
                        description: '找元素',
                        parameters: { type: 'object', properties: {} }
                    }])[0],
                    webSearchTool
                ]
                : undefined
        };
        mixedBodies.push(body);
        return body;
    },
    sendRequest: async () => mixedResponses.shift()
});

assert.strictEqual(mixedBodies.length, 2);
const mixedAssistant = plain(mixedBodies[1].messages[1]);
assert.deepStrictEqual(
    mixedAssistant.content.map((block) => block.type),
    ['server_tool_use', 'tool_use'],
    '混合回合的 assistant 內容要保留伺服器搜尋與頁面工具呼叫'
);
assert.strictEqual(
    plain(mixedBodies[1].messages[2]).content[0].tool_use_id,
    'toolu_mixed',
    '只回傳頁面工具的 tool_result'
);
assert.deepStrictEqual(
    plain(mixedBodies[1].tools).map((tool) => tool.name),
    ['find', 'web_search'],
    '續跑時要保留頁面工具與搜尋工具'
);
assert.strictEqual(mixedResult.answer, '已完成搜尋與頁面操作。');
assert.deepStrictEqual(
    plain(mixedResult.assistantBlocks).map((block) => block.type),
    ['server_tool_use', 'web_search_tool_result', 'text'],
    '最終回覆要保留伺服器搜尋結果，並補回對應的 server_tool_use'
);
assert.strictEqual(
    mixedResult.assistantBlocks[0].id,
    'srvtoolu_mixed',
    '混合工具回合補回的 server_tool_use 要正確配對'
);
assert.deepStrictEqual(plain(mixedResult.citations), [{
    url: 'https://example.com/mixed',
    title: 'Mixed'
}]);

// ===== 工具迴圈：pause_turn 次數上限 =====
let pauseLimitError = null;
try {
    await runAnthropicToolLoop({
        providerLabel: 'Anthropic',
        initialMessages: [{ role: 'user', content: '持續搜尋' }],
        initialUseTools: true,
        buildRequestBody: (messages) => ({ model: 'claude-sonnet-5-5', messages }),
        sendRequest: async () => ({
            content: [{ type: 'server_tool_use', id: 'srvtoolu_loop', name: 'web_search', input: {} }],
            stop_reason: 'pause_turn'
        })
    });
} catch (error) {
    pauseLimitError = error;
}
assert.ok(pauseLimitError, 'pause_turn 超過上限應拋出錯誤');
assert.strictEqual(pauseLimitError.message, 'anthropicPauseTurnLimit');

console.log('anthropic-web-search: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
