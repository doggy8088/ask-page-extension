'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
function section(text, start, end) {
    return text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
}

let storage = {};
const silentConsole = { log() {}, debug() {}, warn() {}, error() {} };
const sandbox = {
    console: silentConsole,
    chrome: {
        storage: {
            local: {
                async get(keys) {
                    return Object.fromEntries(keys.filter((key) => key in storage).map((key) => [key, storage[key]]));
                },
                async set(values) {
                    storage = { ...storage, ...JSON.parse(JSON.stringify(values)) };
                }
            }
        }
    }
};
vm.createContext(sandbox);
vm.runInContext([
    "const OPENAI_COMPATIBLE_REQUEST_QUIRKS_STORAGE = 'ASKPAGE_OPENAI_COMPATIBLE_REQUEST_QUIRKS';",
    'const normalizeModelIdentifier = (model) => String(model || \'\').trim();',
    section(source, 'async function getValue(', 'async function getActiveReasoningValue('),
    section(source, 'function isPromptCacheKeyUnsupportedError(', 'function addConversationTurn('),
    // runOpenAIStyleToolLoop 的依賴，用來確認參數錯誤不會被誤判成不支援 tool calling。
    section(source, '    function isLikelyToolUnsupportedError(', '    function buildTextProviderMessages('),
    section(source, '    async function runOpenAIStyleToolLoop(', '    async function askGemini(')
].join('\n'), sandbox);

Object.assign(sandbox, {
    DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS: 100,
    throwIfAskTaskCancelled() {},
    getToolCallMaxRounds: async () => 5,
    loadAgentToolOutputLimits: async () => {},
    getLocalizedText: (key) => key,
    formatRoundStatus: (_round, message) => message,
    getOpenAIPrimaryChoice: (data) => data.choices[0],
    getOpenAIReasoningSummaries: () => [],
    getAssistantMessageText: (message) => message.content
});

function httpError(apiMessage) {
    const body = JSON.stringify({ error: { message: apiMessage, type: 'invalid_request_error' } });
    const error = new Error(`HTTP 400: ${apiMessage}`);
    error.status = 400;
    error.body = body;
    error.apiMessage = apiMessage;
    return error;
}

const MAX_TOKENS_ERROR = "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
const TEMPERATURE_ERROR = "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported.";

// 模擬只接受 max_completion_tokens、且不接受自訂 temperature 的模型。
function createStrictModelSender(sentBodies) {
    return async (requestBody) => {
        sentBodies.push(requestBody);
        if ('max_tokens' in requestBody) {
            throw httpError(MAX_TOKENS_ERROR);
        }
        if ('temperature' in requestBody) {
            throw httpError(TEMPERATURE_ERROR);
        }
        return { choices: [{ message: { content: 'ok' } }] };
    };
}

async function createQuirkState(activeConfig) {
    return {
        quirks: await sandbox.getOpenAICompatibleRequestQuirks(activeConfig),
        onLearn: (quirks) => sandbox.saveOpenAICompatibleRequestQuirks(activeConfig, quirks)
    };
}

(async () => {
    const activeConfig = { id: 'foundry', type: 'openai-compatible', activeModel: 'mai-code-2-flash' };
    const baseBody = {
        model: 'mai-code-2-flash',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.7,
        max_tokens: 4096,
        tools: [{ type: 'function', function: { name: 'read_page' } }]
    };

    // 預設不改動請求內容。
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(sandbox.applyOpenAICompatibleRequestQuirks(baseBody, await sandbox.getOpenAICompatibleRequestQuirks(activeConfig)))),
        baseBody
    );

    // 第一次呼叫：從錯誤中修正 max_tokens 與 temperature，最後一次請求成功且保留 tools。
    const firstSent = [];
    const firstState = await createQuirkState(activeConfig);
    const firstResult = await sandbox.sendRequestWithOpenAICompatibleQuirks(createStrictModelSender(firstSent), baseBody, null, {}, firstState);
    assert.strictEqual(firstResult.choices[0].message.content, 'ok');
    assert.strictEqual(firstSent.length, 3);
    const finalBody = firstSent[2];
    assert.strictEqual(finalBody.max_completion_tokens, 4096);
    assert.ok(!('max_tokens' in finalBody));
    assert.ok(!('temperature' in finalBody));
    assert.strictEqual(finalBody.tools.length, 1);
    assert.ok('max_tokens' in baseBody, '不應改動呼叫端傳入的 request body');

    // 學到的設定依 provider + model 存起來。
    assert.deepStrictEqual(storage.ASKPAGE_OPENAI_COMPATIBLE_REQUEST_QUIRKS[JSON.stringify(['foundry', 'mai-code-2-flash'])], {
        maxTokensParam: 'max_completion_tokens',
        omitTemperature: true
    });

    // 下一次呼叫第一個請求就送正確參數；其他模型不受影響。
    const secondSent = [];
    await sandbox.sendRequestWithOpenAICompatibleQuirks(createStrictModelSender(secondSent), baseBody, null, {}, await createQuirkState(activeConfig));
    assert.strictEqual(secondSent.length, 1);
    const otherQuirks = await sandbox.getOpenAICompatibleRequestQuirks({ ...activeConfig, activeModel: 'other-model' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(otherQuirks)), { maxTokensParam: 'max_tokens', omitTemperature: false });

    // 若舊的設定失效（端點改回只接受 max_tokens），會自動換回來。
    const reverseSent = [];
    const reverseState = await createQuirkState(activeConfig);
    await sandbox.sendRequestWithOpenAICompatibleQuirks(async (requestBody) => {
        reverseSent.push(requestBody);
        if ('max_completion_tokens' in requestBody) {
            throw httpError("Unrecognized request argument supplied: max_completion_tokens");
        }
        return { choices: [{ message: { content: 'ok' } }] };
    }, baseBody, null, {}, reverseState);
    assert.strictEqual(reverseSent.length, 2);
    assert.strictEqual(reverseSent[1].max_tokens, 4096);
    assert.strictEqual(reverseState.quirks.maxTokensParam, 'max_tokens');

    // 兩種參數都被拒收時不會無限來回重試，而是丟出原本的錯誤。
    let pingPongCount = 0;
    await assert.rejects(sandbox.sendRequestWithOpenAICompatibleQuirks(async (requestBody) => {
        pingPongCount++;
        throw httpError('max_tokens' in requestBody
            ? MAX_TOKENS_ERROR
            : "Unsupported parameter: 'max_completion_tokens' is not supported with this model. Use 'max_tokens' instead.");
    }, baseBody, null, {}, { quirks: { maxTokensParam: 'max_tokens', omitTemperature: false } }), /max_completion_tokens/);
    assert.strictEqual(pingPongCount, 2);

    // 無關的錯誤直接丟出，不重試。
    let unrelatedCount = 0;
    const unrelated = httpError('Invalid API key');
    unrelated.status = 401;
    await assert.rejects(sandbox.sendRequestWithOpenAICompatibleQuirks(async () => {
        unrelatedCount++;
        throw unrelated;
    }, baseBody, null, {}, { quirks: { maxTokensParam: 'max_tokens', omitTemperature: false } }), /Invalid API key/);
    assert.strictEqual(unrelatedCount, 1);

    // 重現截圖情境：在 tool loop 中，max_tokens 錯誤不應被誤判為不支援 tool calling。
    storage = {};
    const loopSent = [];
    const loopState = await createQuirkState(activeConfig);
    const loopResult = await sandbox.runOpenAIStyleToolLoop({
        providerLabel: 'Microsoft Foundry',
        initialMessages: [{ role: 'user', content: 'hi' }],
        initialUseTools: true,
        allowToolFallback: true,
        buildRequestBody: (messages, useTools, maxOutputTokens) => ({
            messages,
            temperature: 0.7,
            max_tokens: maxOutputTokens,
            ...(useTools ? { tools: [{ type: 'function', function: { name: 'read_page' } }] } : {})
        }),
        sendRequest: (requestBody, onRetry, streamHandlers) => sandbox.sendRequestWithOpenAICompatibleQuirks(
            createStrictModelSender(loopSent), requestBody, onRetry, streamHandlers, loopState
        )
    });
    assert.strictEqual(loopResult.answer, 'ok');
    assert.strictEqual(loopResult.fallbackUsed, false);
    assert.ok(loopSent.every((requestBody) => Array.isArray(requestBody.tools)), '修正參數時應保留 tools');
    assert.strictEqual(loopSent.at(-1).max_completion_tokens, 100);

    console.log('openai-compatible-request-quirks: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
