'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8');
function section(text, start, end) {
    const index = text.indexOf(start);
    assert.notStrictEqual(index, -1, `missing section ${start}`);
    return text.slice(index, text.indexOf(end, index + start.length));
}

let stored = {};
let sentToolMessages;
const sandbox = {
    console: { log() {}, debug() {} },
    chrome: { storage: { local: { async get(keys) {
        return Object.fromEntries(keys.filter((key) => key in stored).map((key) => [key, stored[key]]));
    } } } },
    DEFAULT_TOOL_CALL_MAX_ROUNDS: 50,
    TOOL_CALL_MAX_ROUNDS_STORAGE: 'TOOL_CALL_MAX_ROUNDS',
    AGENT_READ_PAGE_DEFAULT_MAX_CHARS: 12000,
    AGENT_READ_PAGE_MIN_MAX_CHARS: 200,
    AGENT_READ_PAGE_MAX_CHARS_LIMIT: 60000,
    READ_PAGE_DEFAULT_MAX_CHARS_STORAGE: 'READ_PAGE_DEFAULT_MAX_CHARS',
    TOOL_RESULT_PREVIEW_MAX_CHARS: 6000,
    MIN_TOOL_RESULT_MAX_CHARS: 1000,
    MAX_TOOL_RESULT_MAX_CHARS: 200000,
    TOOL_RESULT_MAX_CHARS_STORAGE: 'TOOL_RESULT_MAX_CHARS',
    DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS: 100,
    conversationHistory: [],
    throwIfAskTaskCancelled() {},
    getLocalizedText: (key) => key,
    formatRoundStatus: (_round, message) => message,
    formatToolNameList: (names) => names.join(', '),
    formatToolDisplayName: (name) => name,
    parseToolArguments: JSON.parse,
    sendRequestWithPromptCacheKeyFallback: (send) => send(),
    getOpenAIPrimaryChoice: (data) => data.choices[0],
    getOpenAIReasoningSummaries: () => [],
    getAssistantMessageText: (message) => message.content,
    normalizeInputImageDataUrls: () => [],
    getPageConversationContext: async () => ({ conversationContextText: 'page', systemPrompt: 'test' }),
    executeToolCalls: async (calls) => calls.map((call) => ({ ...call, result: { success: true, content: 'x'.repeat(20000) } }))
};
vm.createContext(sandbox);
vm.runInContext([
    section(source, 'function normalizeToolCallMaxRounds(', 'function setValue('),
    section(source, 'function normalizeReadPageMaxChars(', 'function '),
    section(source, '    function getJsonPreview(', '    function escapeSelectorValue('),
    section(source, '    async function runOpenAIStyleToolLoop(', '    async function runGeminiToolLoop(')
].join('\n'), sandbox);

const settingsSandbox = {};
vm.createContext(settingsSandbox);
vm.runInContext([
    section(settings, 'const READ_PAGE_DEFAULT_MAX_CHARS_STORAGE', 'function normalizeToolCallMaxRounds('),
    section(settings, 'function normalizeBoundedIntegerSetting(', 'const CUSTOM_COMMAND_MODE_AGENT')
].join('\n'), settingsSandbox);

(async () => {
    // 設定頁與執行端必須以相同規則解讀缺漏、無效與超出範圍的值。
    const cases = [
        [undefined, 12000, 6000], ['', 12000, 6000], ['bad', 12000, 6000], [Infinity, 12000, 6000],
        [0, 200, 1000], [50, 200, 1000], [99999999, 60000, 200000], ['30000.4', 30000, 30000]
    ];
    for (const [value, readPage, toolResult] of cases) {
        assert.strictEqual(sandbox.normalizeReadPageDefaultMaxChars(value), readPage);
        assert.strictEqual(settingsSandbox.normalizeReadPageDefaultMaxChars(value), readPage);
        assert.strictEqual(sandbox.normalizeToolResultMaxChars(value), toolResult);
        assert.strictEqual(settingsSandbox.normalizeToolResultMaxChars(value), toolResult);
    }

    stored = { READ_PAGE_DEFAULT_MAX_CHARS: 30000, TOOL_RESULT_MAX_CHARS: 40000 };
    await sandbox.loadAgentToolOutputLimits();
    assert.strictEqual(sandbox.normalizeReadPageMaxChars(undefined), 30000, 'read_page 未指定 max_chars 時使用設定值');
    assert.strictEqual(sandbox.normalizeReadPageMaxChars(500), 500, '模型指定的 max_chars 仍優先');

    const longResult = { content: 'y'.repeat(20000) };
    assert.strictEqual(sandbox.getModelToolResultText(longResult), JSON.stringify(longResult, null, 2), '未超過設定上限時完整送回');
    assert.strictEqual(sandbox.buildModelToolResultPayload(longResult), longResult);
    assert.strictEqual(sandbox.getJsonPreview(longResult).length, 6003, 'UI 預覽維持固定 6000 字元');

    stored = { TOOL_RESULT_MAX_CHARS: 1000 };
    await sandbox.loadAgentToolOutputLimits();
    assert.strictEqual(sandbox.normalizeReadPageMaxChars(undefined), 12000, '移除設定後回到預設值');
    assert.strictEqual(sandbox.getModelToolResultText(longResult).length, 1003);
    const payload = sandbox.buildModelToolResultPayload(longResult);
    assert.strictEqual(payload.truncated, true);
    assert.strictEqual(payload.preview.length, 1003);
    assert.match(payload.note, /1000 字元/);

    // OpenAI 相容迴圈在任務開始時讀取設定，並以該上限截斷送回模型的工具結果。
    stored = { TOOL_RESULT_MAX_CHARS: 2500 };
    sentToolMessages = [];
    let requests = 0;
    await sandbox.runOpenAIStyleToolLoop({
        providerLabel: 'test', initialMessages: [],
        buildRequestBody: (messages) => {
            sentToolMessages = messages.filter((message) => message.role === 'tool');
            return {};
        },
        sendRequest: async () => {
            requests++;
            return { choices: [{ message: requests > 1
                ? { content: 'done' }
                : { tool_calls: [{ id: '1', function: { name: 'get_page_text', arguments: '{}' } }] } }] };
        }
    });
    assert.strictEqual(sentToolMessages.length, 1);
    assert.strictEqual(sentToolMessages[0].content.length, 2503);
    console.log('tool-output-limits: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
