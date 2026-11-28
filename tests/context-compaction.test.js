'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const compactor = require('../src/lib/context-compaction.js');
const anthropicTools = require('../src/lib/anthropic-tools.js');
const contentSource = fs.readFileSync(path.join(rootDir, 'src', 'content.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(rootDir, 'src', 'settings.js'), 'utf8');
const messagesCatalog = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'src', '_locales', 'zh_TW', 'messages.json'), 'utf8')
);

function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `Missing marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start + 1);
    assert.notStrictEqual(end, -1, `Missing end marker: ${endMarker}`);
    return source.slice(start, end);
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function createStorageMock(initial = {}) {
    const store = { ...initial };
    return {
        store,
        local: {
            async get(keys) {
                const list = Array.isArray(keys) ? keys : [keys];
                const result = {};
                for (const key of list) {
                    if (Object.prototype.hasOwnProperty.call(store, key)) {
                        result[key] = plain(store[key]);
                    }
                }
                return result;
            },
            async set(values) {
                Object.assign(store, plain(values));
            }
        }
    };
}

function createContentSandbox(initialStorage = {}) {
    const storageMock = createStorageMock(initialStorage);
    const sandbox = {
        console: { log() {}, debug() {}, warn() {}, error() {}, info() {} },
        logCompactionDiagnostic() {},
        TextDecoder,
        TextEncoder,
        AbortController,
        URL,
        WeakRef,
        AskPageContextCompaction: compactor,
        AskPageAnthropicTools: anthropicTools,
        marked: {},
        DOMPurify: { sanitize(v) { return v; } },
        chrome: {
            runtime: {
                getURL: (p) => p,
                onMessage: { addListener() {} },
                sendMessage() {}
            },
            storage: storageMock
        },
        document: {
            readyState: 'complete',
            title: '測試頁',
            location: { href: 'https://example.com/test' },
            body: { innerText: '' },
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            getElementsByTagName() { return []; }
        },
        window: {
            location: { href: 'https://example.com/test' },
            getComputedStyle() { return { display: 'block', visibility: 'visible' }; }
        }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${contentSource}
globalThis.__compactionContentExports = {
    addConversationTurn,
    clearConversationHistory,
    truncateConversationFromTurn,
    applyConversationCompactionState,
    buildHistoryPayloadWithEndCounts,
    getConversationMessagesForTextProviders,
    buildAnthropicConversationMessages,
    buildGeminiConversationSteps,
    resolveActiveModelContextWindow,
    saveLearnedModelContextWindow,
    getConversationHistory: () => conversationHistory,
    getCompactionState: () => conversationCompactionState
};`, sandbox, { filename: 'content.js' });
    return { sandbox, storageMock, exports: sandbox.__compactionContentExports };
}

(async () => {
    // ===== 1. 模型 Context Window 解析與 ai-cost-litellm 交叉比對 =====
    assert.strictEqual(compactor.resolveModelContextWindow('gemini', 'gemini-4-neon').contextWindow, 1048576);
    assert.strictEqual(compactor.resolveModelContextWindow('gemini', 'gemma-4-31b-it').contextWindow, 262144);
    assert.strictEqual(compactor.resolveModelContextWindow('openai', 'gpt-6-astra').contextWindow, 1050000);
    assert.strictEqual(compactor.resolveModelContextWindow('openai', 'gpt-4o-mini').contextWindow, 128000);
    assert.strictEqual(compactor.resolveModelContextWindow('anthropic', 'claude-haiku-5-5').contextWindow, 1000000);
    assert.strictEqual(compactor.resolveModelContextWindow('anthropic', 'claude-haiku-4-5').contextWindow, 200000);
    assert.strictEqual(compactor.resolveModelContextWindow('deepseek', 'deepseek-v4-pro').contextWindow, 1048576);

    // 同一模型在不同供應商應有不同上限
    assert.strictEqual(compactor.resolveModelContextWindow('groq', 'qwen/qwen3.8-27b').contextWindow, 131072);
    assert.strictEqual(compactor.resolveModelContextWindow('openrouter', 'qwen/qwen3.8-27b').contextWindow, 262144);
    assert.strictEqual(compactor.resolveModelContextWindow('mistral', 'mistral-large-latest').contextWindow, 1000000);
    assert.strictEqual(compactor.resolveModelContextWindow('ollama-cloud', 'mistral-large-4').contextWindow, 524288);

    // ai-cost-litellm 實測特殊值
    assert.strictEqual(compactor.resolveModelContextWindow('ollama-cloud', 'glm-5.3').contextWindow, 1048568);
    assert.strictEqual(compactor.resolveModelContextWindow('ollama-cloud', 'glm-5.2').contextWindow, 1000000);
    assert.strictEqual(compactor.resolveModelContextWindow('ollama-cloud', 'minimax-m2.7').contextWindow, 196608);
    assert.strictEqual(compactor.resolveModelContextWindow('ollama-cloud', 'gemma4:31b').contextWindow, 262144);
    assert.strictEqual(compactor.resolveModelContextWindow('ollama-cloud', 'clef:cloud').contextWindow, 65529);
    assert.strictEqual(compactor.resolveModelContextWindow('ollama-cloud', 'deepseek-v4.1-flash:1017-cloud').contextWindow, 1048576);

    // 前綴、動態快取覆寫與預設值
    assert.strictEqual(compactor.resolveModelContextWindow('openai', 'gpt-4o-2024-11-20').contextWindow, 128000);
    assert.strictEqual(compactor.resolveModelContextWindow('anthropic', 'claude-sonnet-4-6-20260217').contextWindow, 1000000);
    assert.strictEqual(compactor.resolveModelContextWindow('openai-compatible', 'unknown-custom-model').contextWindow, 131072);
    assert.strictEqual(
        compactor.resolveModelContextWindow('openrouter', 'qwen/qwen3.8-27b', {
            cachedLimits: { 'openrouter::qwen/qwen3.8-27b': 1000000 }
        }).contextWindow,
        1000000
    );

    // ===== 2. /models API 回應擷取與 settings.js 快取 =====
    assert.strictEqual(compactor.extractContextWindowFromModelEntry('gemini', { name: 'models/gemini-4-neon', inputTokenLimit: 1048576 }), 1048576);
    assert.strictEqual(compactor.extractContextWindowFromModelEntry('anthropic', { id: 'claude-haiku-5-5', max_input_tokens: 1000000 }), 1000000);
    assert.strictEqual(compactor.extractContextWindowFromModelEntry('openrouter', { id: 'qwen/qwen3.8-27b', context_length: 1000000 }), 1000000);
    assert.strictEqual(compactor.extractContextWindowFromModelEntry('groq', { id: 'qwen/qwen3.8-27b', context_window: 131072 }), 131072);
    assert.strictEqual(compactor.extractContextWindowFromModelEntry('mistral', { id: 'mistral-medium-latest', max_context_length: 256000 }), 256000);

    const settingsStorage = createStorageMock();
    const settingsSandbox = {
        console: { log() {}, warn() {}, error() {} },
        AskPageContextCompaction: compactor,
        chrome: { storage: settingsStorage }
    };
    settingsSandbox.globalThis = settingsSandbox;
    vm.createContext(settingsSandbox);
    vm.runInContext(
        sliceBetween(settingsSource, 'async function saveDiscoveredModelContextWindows(', 'async function probeGeminiApiKeyTier('),
        settingsSandbox
    );
    await settingsSandbox.saveDiscoveredModelContextWindows('openrouter', [
        { id: 'qwen/qwen3.8-27b', context_length: 1000000 },
        { id: 'no-limit-model' }
    ]);
    assert.strictEqual(
        settingsStorage.store[compactor.MODEL_CONTEXT_WINDOWS_STORAGE]['openrouter::qwen/qwen3.8-27b'],
        1000000
    );

    // ===== 3. 超限錯誤辨識與數字解析 =====
    assert.strictEqual(compactor.isContextWindowExceededError({
        status: 400,
        apiMessage: 'This model\'s maximum context length is 8192 tokens. However, your messages resulted in 10200 tokens.'
    }), true);
    assert.strictEqual(compactor.isContextWindowExceededError({
        status: 400,
        apiMessage: 'prompt is too long: 205000 tokens > 200000 maximum'
    }), true);
    assert.strictEqual(compactor.isContextWindowExceededError({
        status: 400,
        apiMessage: 'exceeds model\'s maximum output tokens (131072)'
    }), false, '輸出上限參數錯誤不得誤判為 Context Window 超限');

    assert.strictEqual(compactor.parseContextWindowLimitFromError({
        apiMessage: 'This model\'s maximum context length is 8,192 tokens.'
    }), 8192);
    assert.strictEqual(compactor.parseContextWindowLimitFromError({
        apiMessage: 'prompt is too long: 210000 tokens > 200000 maximum'
    }), 200000);
    assert.strictEqual(compactor.parseContextWindowLimitFromError({
        apiMessage: 'Request requires 70129 tokens; the maximum is 65529'
    }), 65529);
    assert.strictEqual(compactor.parseContextWindowLimitFromError({
        apiMessage: 'prompt too long; exceeded max context length by 1200 tokens'
    }, 10000), 8800);

    // ===== 4. Token 估算與 Anthropic 用量加總 =====
    const hugeBase64 = 'data:image/png;base64,' + 'A'.repeat(200000);
    const imageTokens = compactor.estimatePayloadTokens({
        format: 'openai',
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: '分析圖片' },
                { type: 'image_url', image_url: { url: hugeBase64 } }
            ]
        }]
    });
    assert.ok(imageTokens < 3000, `Base64 圖片不應依字元數膨脹，實測 ${imageTokens}`);
    assert.strictEqual(compactor.extractReportedInputTokens('anthropic', {
        input_tokens: 1200,
        cache_creation_input_tokens: 3000,
        cache_read_input_tokens: 40000
    }), 44200);

    // ===== 5. OpenAI 工具迴圈：80% 主動壓縮（LLM 摘要 + 失敗降級）=====
    {
        const loopSandbox = {
            console: { log() {}, debug() {}, warn() {}, error() {} },
            AskPageContextCompaction: compactor,
            DEFAULT_TOOL_CALL_MAX_ROUNDS: 50,
            TOOL_CALL_MAX_ROUNDS_STORAGE: 'TOOL_CALL_MAX_ROUNDS',
            DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS: 4096,
            getToolCallMaxRounds: async () => 10,
            loadAgentToolOutputLimits: async () => {},
            throwIfAskTaskCancelled() {},
            logCompactionDiagnostic() {},
            getLocalizedText: (key, params = {}) => `${key}:${JSON.stringify(params)}`,
            formatRoundStatus: (_r, msg) => msg,
            formatToolNameList: (names) => names.join(', '),
            formatToolDisplayName: (name) => name,
            parseToolArguments: JSON.parse,
            sendRequestWithPromptCacheKeyFallback: (send, body, onRetry, handlers) => send(body, onRetry, handlers),
            getOpenAIPrimaryChoice: (data) => data.choices[0],
            getOpenAIReasoningSummaries: () => [],
            getAssistantMessageText: (message) => message?.content || '',
            getModelToolResultText: (res) => JSON.stringify(res),
            executeToolCalls: async (calls) => calls.map((call) => ({
                id: call.id,
                name: call.name,
                result: { success: true, text: 'X'.repeat(6000) }
            }))
        };
        loopSandbox.globalThis = loopSandbox;
        vm.createContext(loopSandbox);
        vm.runInContext(
            [
                sliceBetween(contentSource, 'const TOOL_SUMMARY_MAX_ENTRIES = 12;', 'function buildTextProviderTurnMessage('),
                sliceBetween(contentSource, '    async function runOpenAIStyleToolLoop(', '    async function runGeminiToolLoop(')
            ].join('\n'),
            loopSandbox
        );

        const capturedRequests = [];
        const statuses = [];
        let callIndex = 0;
        const result = await loopSandbox.runOpenAIStyleToolLoop({
            providerLabel: 'OpenAI',
            initialMessages: [
                { role: 'system', content: 'System prompt\n\nUse the following web page context for this conversation.\nPage body' },
                { role: 'user', content: '請逐步檢視頁面。' }
            ],
            compaction: {
                providerType: 'openai',
                model: 'test-10k',
                contextWindow: 10000
            },
            buildRequestBody: (messages, useTools, maxOutputTokens) => ({
                model: 'test-10k',
                messages: plain(messages),
                useTools,
                max_tokens: maxOutputTokens
            }),
            sendRequest: async (body) => {
                capturedRequests.push(plain(body));
                callIndex++;
                if (body.messages[0]?.role === 'system' && body.messages[0].content.includes('conversation context compactor')) {
                    return { choices: [{ message: { content: '先前已完成 3 輪 read_page，目前準備收尾。' } }] };
                }
                if (callIndex <= 4) {
                    return {
                        choices: [{
                            message: {
                                content: null,
                                tool_calls: [{ id: `call_${callIndex}`, function: { name: 'read_page', arguments: '{}' } }]
                            }
                        }],
                        usage: { prompt_tokens: 2500 * callIndex }
                    };
                }
                return {
                    choices: [{ message: { content: '任務完成！' } }],
                    usage: { prompt_tokens: 3000 }
                };
            },
            onStatusUpdate: (s) => statuses.push(s)
        });

        assert.strictEqual(result.answer, '任務完成！');
        assert.ok(statuses.some((s) => s.includes('statusContextCompacting')), '達到 80% 時應觸發主動壓縮狀態');
        assert.ok(statuses.some((s) => s.includes('statusContextCompacted')), '應回報壓縮完成統計');
        assert.ok(
            capturedRequests.some((req) => req.messages[0]?.content?.includes('conversation context compactor') && req.useTools === false),
            '壓縮摘要呼叫應關閉工具且不影響主對話串流'
        );
        const postCompactionReq = capturedRequests[capturedRequests.length - 1];
        assert.ok(
            postCompactionReq.messages.some((m) => typeof m.content === 'string' && m.content.includes(compactor.COMPACTION_SUMMARY_HEADER)),
            '壓縮後的主請求應帶入上下文摘要'
        );

        // 若摘要 API 失敗，應降級為本地決定性壓縮並完成任務
        let fallbackRound = 0;
        const fallbackResult = await loopSandbox.runOpenAIStyleToolLoop({
            providerLabel: 'OpenAI',
            initialMessages: [
                { role: 'system', content: 'System prompt' },
                { role: 'user', content: '步驟 1：' + 'Y'.repeat(18000) },
                { role: 'assistant', content: '好的' },
                { role: 'user', content: '請繼續' }
            ],
            compaction: {
                providerType: 'openai',
                model: 'test-8k',
                contextWindow: 8000
            },
            buildRequestBody: (messages, useTools, maxOutputTokens) => ({
                messages: plain(messages),
                useTools,
                max_tokens: maxOutputTokens
            }),
            sendRequest: async (body) => {
                if (body.messages[0]?.content?.includes('conversation context compactor')) {
                    throw new Error('Summary endpoint unavailable');
                }
                fallbackRound++;
                return { choices: [{ message: { content: `fallback-ok-${fallbackRound}` } }] };
            }
        });
        assert.strictEqual(fallbackResult.answer, 'fallback-ok-1');
    }

    // ===== 6. 小模型提早超限：自動學習上限、裁減 max_tokens 與頁面上下文後重試成功 =====
    {
        const storageMock = createStorageMock();
        const loopSandbox = {
            console: { log() {}, debug() {}, warn() {}, error() {} },
            AskPageContextCompaction: compactor,
            DEFAULT_TOOL_CALL_MAX_ROUNDS: 50,
            DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS: 32768,
            getToolCallMaxRounds: async () => 5,
            loadAgentToolOutputLimits: async () => {},
            throwIfAskTaskCancelled() {},
            logCompactionDiagnostic() {},
            getLocalizedText: (key) => key,
            formatRoundStatus: (_r, msg) => msg,
            formatToolNameList: (names) => names.join(', '),
            formatToolDisplayName: (name) => name,
            parseToolArguments: JSON.parse,
            sendRequestWithPromptCacheKeyFallback: (send, body, onRetry, handlers) => send(body, onRetry, handlers),
            getOpenAIPrimaryChoice: (data) => data.choices[0],
            getOpenAIReasoningSummaries: () => [],
            getAssistantMessageText: (message) => message?.content || ''
        };
        loopSandbox.globalThis = loopSandbox;
        vm.createContext(loopSandbox);
        vm.runInContext(
            [
                sliceBetween(contentSource, 'const TOOL_SUMMARY_MAX_ENTRIES = 12;', 'function buildTextProviderTurnMessage('),
                sliceBetween(contentSource, '    async function runOpenAIStyleToolLoop(', '    async function runGeminiToolLoop(')
            ].join('\n'),
            loopSandbox
        );

        let learnedWindowSaved = 0;
        let streamedDiscarded = false;
        let attempts = 0;
        const recoveryRequests = [];
        const hugeSnapshot = 'S'.repeat(30000);
        const answer = await loopSandbox.runOpenAIStyleToolLoop({
            providerLabel: 'LocalOllama',
            initialMessages: [
                {
                    role: 'system',
                    content: `System rules.${'\n\n'}Use the following web page context for this conversation.\n\nFull page content:\n${hugeSnapshot}`
                },
                { role: 'user', content: '請摘要重點' }
            ],
            initialMaxOutputTokens: 32768,
            compaction: {
                providerType: 'ollama',
                model: 'small-local-8k',
                contextWindow: 131072,
                onContextWindowLearned: async (limit) => {
                    learnedWindowSaved = limit;
                    storageMock.store[compactor.MODEL_CONTEXT_WINDOWS_STORAGE] = { 'ollama::small-local-8k': limit };
                },
                onResetStreamedAnswer: () => {
                    streamedDiscarded = true;
                }
            },
            buildRequestBody: (messages, useTools, maxOutputTokens) => ({
                messages: plain(messages),
                useTools,
                max_tokens: maxOutputTokens
            }),
            sendRequest: async (body) => {
                recoveryRequests.push(plain(body));
                attempts++;
                if (attempts === 1) {
                    const err = new Error('HTTP 400');
                    err.status = 400;
                    err.apiMessage = 'This model\'s maximum context length is 8192 tokens. However, you requested 40000 tokens.';
                    throw err;
                }
                const estTokens = compactor.estimatePayloadTokens({ format: 'openai', messages: body.messages });
                assert.ok(estTokens + body.max_tokens <= 8192, `縮減後總和 (${estTokens} + ${body.max_tokens}) 應小於等於 8192`);
                return { choices: [{ message: { content: '成功接續回答！' } }] };
            }
        });

        assert.strictEqual(answer.answer, '成功接續回答！');
        assert.strictEqual(learnedWindowSaved, 8192);
        assert.strictEqual(streamedDiscarded, true);
        assert.ok(recoveryRequests.length >= 2);
    }

    // ===== 7. Anthropic 工具迴圈：維持交替角色與 tool_use / tool_result 配對 =====
    {
        const anthropicSandbox = {
            console: { log() {}, debug() {}, warn() {}, error() {} },
            AskPageContextCompaction: compactor,
            AskPageAnthropicTools: anthropicTools,
            getToolCallMaxRounds: async () => 5,
            loadAgentToolOutputLimits: async () => {},
            throwIfAskTaskCancelled() {},
            logCompactionDiagnostic() {},
            getLocalizedText: (key) => key,
            formatRoundStatus: (_r, msg) => msg,
            formatToolDisplayName: (name) => name,
            formatToolNameList: (names) => names.join(', '),
            parseToolArguments: (raw) => anthropicTools.parseAnthropicToolInput(raw),
            isLikelyToolUnsupportedError: () => false,
            buildAnthropicThinkingBlocks: anthropicTools.buildAnthropicThinkingBlocks,
            buildAnthropicAssistantBlocks: anthropicTools.buildAnthropicAssistantBlocks,
            buildAnthropicToolResultBlock: anthropicTools.buildAnthropicToolResultBlock,
            collectAnthropicWebSearchCitations: anthropicTools.collectAnthropicWebSearchCitations,
            executeToolCalls: async (calls) => calls.map((call) => ({
                id: call.id,
                name: call.name,
                result: { success: true, text: 'OK' }
            }))
        };
        anthropicSandbox.globalThis = anthropicSandbox;
        vm.createContext(anthropicSandbox);
        vm.runInContext(
            [
                sliceBetween(contentSource, 'const TOOL_SUMMARY_MAX_ENTRIES = 12;', 'function buildTextProviderTurnMessage('),
                sliceBetween(contentSource, '    async function runAnthropicToolLoop(', '    async function askAnthropic(')
            ].join('\n'),
            anthropicSandbox
        );

        const sentAnthropicPayloads = [];
        const res = await anthropicSandbox.runAnthropicToolLoop({
            providerLabel: 'Anthropic',
            initialMessages: [
                { role: 'user', content: '問題一' },
                {
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: 'tu_1', name: 'read_page', input: {} }]
                },
                {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'Z'.repeat(16000) }]
                },
                { role: 'assistant', content: [{ type: 'text', text: '中繼回答' }] },
                { role: 'user', content: '最新問題' }
            ],
            compaction: {
                providerType: 'anthropic',
                model: 'claude-test',
                contextWindow: 6000,
                systemPrompt: 'System instructions',
                maxOutputTokens: 2048,
                sendCompactionRequest: async () => '已讀取頁面摘要。'
            },
            buildRequestBody: (messages, useTools, overrides = {}) => {
                const body = {
                    messages: plain(messages),
                    system: overrides.systemPrompt || 'System instructions',
                    max_tokens: overrides.maxOutputTokens || 2048
                };
                sentAnthropicPayloads.push(body);
                return body;
            },
            sendRequest: async () => ({
                content: [{ type: 'text', text: 'Anthropic 最終回答' }],
                usage: { input_tokens: 800, cache_read_input_tokens: 200 }
            })
        });

        assert.strictEqual(res.answer, 'Anthropic 最終回答');
        const msgList = sentAnthropicPayloads[0].messages;
        assert.strictEqual(msgList[0].role, 'user', 'Anthropic 首則訊息必須為 user');
        for (let i = 1; i < msgList.length; i++) {
            assert.notStrictEqual(msgList[i].role, msgList[i - 1].role, 'Anthropic 訊息角色必須嚴格交替');
        }
    }

    // ===== 8. Gemini 工具迴圈：主動壓縮與對話狀態整合 =====
    {
        const { sandbox: contentSandbox, exports: contentExports } = createContentSandbox();
        contentExports.clearConversationHistory();
        contentExports.addConversationTurn('user', '第一題：' + 'Q'.repeat(16000));
        contentExports.addConversationTurn('assistant', '第一答：' + 'A'.repeat(16000));
        contentExports.addConversationTurn('user', '第二題：請整理結論');

        assert.strictEqual(contentExports.getConversationHistory().length, 3);

        // 執行 runGeminiToolLoop，模擬 8K contextWindow 觸發 80% 壓縮
        contentSandbox.getPageConversationContext = async () => ({
            systemPrompt: 'Gemini system',
            conversationContextText: 'Page snapshot short',
            contextMode: 'snapshot'
        });
        contentSandbox.createGeminiServiceWorkerFetch = () => async () => {};
        contentSandbox.getToolCallMaxRounds = async () => 5;
        contentSandbox.loadAgentToolOutputLimits = async () => {};
        contentSandbox.resolveActiveModelContextWindow = async () => ({ contextWindow: 8000, thresholdTokens: 6400 });
        contentSandbox.throwIfAskTaskCancelled = () => {};
        contentSandbox.getLocalizedText = (key) => key;
        contentSandbox.formatRoundStatus = (_r, msg) => msg;
        contentSandbox.getGeminiMaxOutputTokens = () => 2048;
        contentSandbox.buildGeminiThinkingConfig = () => ({});
        contentSandbox.getGeminiToolDefinitions = () => [];
        contentSandbox.getGeminiInteractionText = (res) => res?.steps?.find((s) => s.type === 'model_output')?.content?.[0]?.text || '';
        contentSandbox.getRetryAfterMilliseconds = () => null;
        contentSandbox.createHttpError = (status, statusText, body, message) => Object.assign(new Error(message || body), { status, statusText, body });
        contentSandbox.GEMINI_INTERACTIONS_URL = 'https://example.invalid/interactions';
        contentSandbox.GEMINI_API_REVISION = '2026-05-20';
        const geminiPayloads = [];
        contentSandbox.fetchJsonWithRetry = async ({ options }) => {
            const body = JSON.parse(options.body);
            geminiPayloads.push(body);
            if (body.system_instruction.includes('conversation context compactor')) {
                return { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '第一輪問答已壓縮摘要。' }] }] };
            }
            return {
                status: 'completed',
                steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Gemini 最終回覆' }] }],
                usage: { promptTokenCount: 1500 }
            };
        };

        const geminiSliceSandbox = contentSandbox;
        vm.runInContext(`
${sliceBetween(contentSource, '    async function runGeminiToolLoop(', '    async function askGemini(')}
globalThis.__runGeminiToolLoop = runGeminiToolLoop;
`, geminiSliceSandbox, { filename: 'content.js' });

        // 需要執行 createDialog 中的 helpers
        const loopResult = await geminiSliceSandbox.__runGeminiToolLoop({
            apiKey: 'test-key',
            selectedModel: 'gemini-4-neon',
            enableTools: false,
            streamingEnabled: false
        });
        assert.strictEqual(loopResult.text, 'Gemini 最終回覆');
        assert.strictEqual(geminiPayloads.length, 2, '應先送出壓縮摘要請求，再送出壓縮後主請求');
        assert.strictEqual(contentExports.getConversationHistory().length, 3, 'UI conversationHistory 不得被裁切');
        assert.ok(contentExports.getCompactionState(), '應記錄 conversationCompactionState');

        // 後續回合應自動帶入壓縮摘要 + 未壓縮尾端，但 UI conversationHistory 仍完整
        contentExports.addConversationTurn('assistant', 'Gemini 最終回覆');
        contentExports.addConversationTurn('user', '第三題追問');
        const nextTurnMessages = contentExports.getConversationMessagesForTextProviders();
        assert.ok(
            nextTurnMessages[0].content.includes(compactor.COMPACTION_SUMMARY_HEADER),
            '後續回合送給模型的訊息應以壓縮摘要開頭'
        );
        assert.strictEqual(nextTurnMessages[nextTurnMessages.length - 1].content, '第三題追問');

        // 編輯歷史早期訊息時應重置 stale compaction state
        const firstTurn = contentExports.getConversationHistory()[0];
        contentExports.truncateConversationFromTurn(firstTurn, '修改後的第一題');
        assert.strictEqual(contentExports.getCompactionState(), null);

        contentExports.applyConversationCompactionState('tmp summary', 1);
        contentExports.clearConversationHistory();
        assert.strictEqual(contentExports.getCompactionState(), null);
    }

    // ===== 9. 使用者取消任務時，壓縮請求必須立即中止並拋出 AbortError =====
    {
        const controller = new AbortController();
        const cancellationSandbox = {
            console: { log() {}, debug() {}, warn() {}, error() {} },
            AskPageContextCompaction: compactor,
            DEFAULT_TOOL_CALL_MAX_ROUNDS: 50,
            DEFAULT_OPENAI_STYLE_MAX_OUTPUT_TOKENS: 4096,
            getToolCallMaxRounds: async () => 5,
            loadAgentToolOutputLimits: async () => {},
            throwIfAskTaskCancelled(ctx) {
                const sig = ctx?.signal || ctx;
                if (sig?.aborted) {
                    const err = new Error('Cancelled');
                    err.name = 'AbortError';
                    throw err;
                }
            },
            getLocalizedText: (key) => key,
            logCompactionDiagnostic() {},
            formatRoundStatus: (_r, msg) => msg,
            sendRequestWithPromptCacheKeyFallback: (send, body, onRetry, handlers) => send(body, onRetry, handlers),
            getOpenAIPrimaryChoice: (data) => data.choices[0],
            getAssistantMessageText: (m) => m?.content || ''
        };
        cancellationSandbox.globalThis = cancellationSandbox;
        vm.createContext(cancellationSandbox);
        vm.runInContext(
            [
                sliceBetween(contentSource, 'const TOOL_SUMMARY_MAX_ENTRIES = 12;', 'function buildTextProviderTurnMessage('),
                sliceBetween(contentSource, '    async function runOpenAIStyleToolLoop(', '    async function runGeminiToolLoop(')
            ].join('\n'),
            cancellationSandbox
        );

        await assert.rejects(
            cancellationSandbox.runOpenAIStyleToolLoop({
                providerLabel: 'OpenAI',
                signal: controller.signal,
                initialMessages: [
                    { role: 'system', content: 'System' },
                    { role: 'user', content: 'A'.repeat(16000) },
                    { role: 'assistant', content: 'B'.repeat(4000) },
                    { role: 'user', content: 'C' }
                ],
                compaction: {
                    providerType: 'openai',
                    model: 'test-6k',
                    contextWindow: 6000
                },
                buildRequestBody: (messages) => ({ messages }),
                sendRequest: async () => {
                    controller.abort();
                    const err = new Error('Aborted');
                    err.name = 'AbortError';
                    throw err;
                }
            }),
            (err) => err?.name === 'AbortError'
        );
    }

    assert.ok(messagesCatalog.statusContextCompacting);
    assert.ok(messagesCatalog.statusContextOverflowCompacting);
    assert.ok(messagesCatalog.statusContextCompacted);

    console.log('context-compaction: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
