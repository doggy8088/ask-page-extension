'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8');
function section(text, start, end) {
    return text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
}

let storedLimit;
let requests;
let executed;
let finishAfter;
const toolCalls = [1, 2].map((id) => ({ id: String(id), name: 'read_page', arguments: {} }));
function nextResponse() {
    requests++;
    // A setting changed during execution applies only to the next task.
    storedLimit = 1;
    return requests > finishAfter;
}
const sandbox = {
    console: { log() {}, debug() {} },
    chrome: { storage: { local: { async get() { return { TOOL_CALL_MAX_ROUNDS: storedLimit }; } } } },
    DEFAULT_TOOL_CALL_MAX_ROUNDS: 50,
    TOOL_CALL_MAX_ROUNDS_STORAGE: 'TOOL_CALL_MAX_ROUNDS',
    DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS: 100,
    GEMINI_INTERACTIONS_URL: 'https://example.invalid', GEMINI_API_REVISION: 'test',
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
    createGeminiServiceWorkerFetch() {},
    getGeminiMaxOutputTokens: () => 100,
    buildGeminiConversationSteps: () => [],
    buildGeminiThinkingConfig: () => ({}),
    getGeminiToolDefinitions: () => [],
    getGeminiInteractionText: (data) => data.text || '',
    buildModelToolResultPayload: (result) => result,
    getJsonPreview: JSON.stringify,
    fetchJsonWithRetry: async () => nextResponse()
        ? { status: 'completed', steps: [], text: 'done' }
        : { status: 'requires_action', steps: toolCalls.map((call) => ({ ...call, type: 'function_call' })) },
    executeToolCalls: async (calls) => {
        executed += calls.length;
        return calls.map((call) => ({ ...call, result: { success: true } }));
    }
};
vm.createContext(sandbox);
vm.runInContext([
    section(source, 'function normalizeToolCallMaxRounds(', 'function setValue('),
    section(source, '    async function runOpenAIStyleToolLoop(', '    async function askGemini(')
].join('\n'), sandbox);

(async () => {
    // Settings and execution must interpret missing, imported, and invalid values identically.
    const settingsSandbox = { DEFAULT_TOOL_CALL_MAX_ROUNDS: 50 };
    vm.createContext(settingsSandbox);
    vm.runInContext(section(settings, 'function normalizeToolCallMaxRounds(', 'function normalizeAgentSnapshotTokenBudget('), settingsSandbox);
    for (const value of [undefined, null, '', 0, -1, 1.5, 'bad', Infinity, Number.MAX_SAFE_INTEGER + 1, 1, 75, '120']) {
        const expected = Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 50;
        assert.strictEqual(sandbox.normalizeToolCallMaxRounds(value), expected);
        assert.strictEqual(settingsSandbox.normalizeToolCallMaxRounds(value), expected);
    }
    const runners = [
        () => sandbox.runOpenAIStyleToolLoop({
            providerLabel: 'test', initialMessages: [], buildRequestBody: () => ({}),
            sendRequest: async () => ({ choices: [{ message: nextResponse()
                ? { content: 'done' }
                : { tool_calls: toolCalls.map((call) => ({ id: call.id, function: { name: call.name, arguments: '{}' } })) }
            }] })
        }),
        () => sandbox.runGeminiToolLoop({ apiKey: 'test', selectedModel: 'test' })
    ];
    for (const run of runners) {
        for (const [limit, expected] of [[undefined, 50], [2, 2], [55, 55], [0, 50]]) {
            storedLimit = limit;
            requests = executed = 0;
            finishAfter = Infinity;
            await assert.rejects(run(), /toolCallLimitExceeded/);
            assert.strictEqual(requests, expected);
            assert.strictEqual(executed, expected * 2, 'The limit counts rounds, not individual calls');
        }
        storedLimit = 3;
        requests = executed = 0;
        finishAfter = 1;
        await run();
        assert.strictEqual(requests, 2);
        assert.strictEqual(executed, 2);
    }
    console.log('tool-call-round-limit: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
