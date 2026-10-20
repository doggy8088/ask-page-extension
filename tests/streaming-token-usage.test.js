'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const messages = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales/zh_TW/messages.json'), 'utf8'));
let request;
let chunks;
const usage = { prompt_tokens: 120, completion_tokens: 35, total_tokens: 155 };
const sandbox = {
    fetch() {},
    TextDecoder,
    throwIfAskTaskCancelled() {},
    getLocalizedText: (key, substitutions = {}) => (messages[key]?.message || key)
        .replace(/\$([a-zA-Z]+)\$/g, (_match, name) => substitutions[name] ?? '')
        .replace(/\\n/g, '\n'),
    normalizeResponsesApiResponse: (response) => response,
    fetchSseWithRetry: async (options) => {
        request = JSON.parse(options.options.body);
        // Exercise the real SSE reader, including network boundaries inside JSON.
        const text = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
        const bytes = Buffer.from(text);
        let offset = 0;
        await sandbox.readServerSentEvents({ body: { getReader: () => ({
            read: async () => {
                if (offset >= bytes.length) return { done: true };
                const value = bytes.subarray(offset, offset + 7);
                offset += 7;
                return { value, done: false };
            },
            cancel: async () => {}
        }) } }, options.onEvent);
    }
};
vm.createContext(sandbox);
function loadBetween(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + 1);
    assert(start >= 0 && end > start);
    vm.runInContext(source.slice(start, end), sandbox);
}
loadBetween('function getFiniteTokenUsageValue(', 'function getResponsesApiTextPartValue(');
loadBetween('    async function readServerSentEvents(', '    async function fetchSseWithRetry(');
loadBetween('    function parseSseJsonEvent(', '    function mergeGeminiInteractionEvent(');

(async () => {
    const requiredProviders = ['openai', 'azure', 'ollama', 'ollama-cloud'];
    const automaticOrUnverifiedProviders = ['deepseek', 'openrouter', 'groq', 'mistral', 'meta', 'openai-compatible', 'unknown', ''];
    chunks = [
        { choices: [{ delta: { content: '回答' }, finish_reason: 'stop' }], usage: null },
        { choices: [], usage },
        { choices: [], usage: null }
    ];
    for (const providerType of [...requiredProviders, ...automaticOrUnverifiedProviders]) {
        const options = {
            providerType, providerLabel: providerType, url: 'https://example.invalid/chat/completions',
            requestBody: { model: 'test' }, headers: {}
        };
        const response = await sandbox.fetchOpenAIChatCompletionsStream(options);
        assert.strictEqual(request.stream, true);
        if (requiredProviders.includes(providerType)) {
            assert.strictEqual(request.stream_options?.include_usage, true, `${providerType} must request streamed usage`);
        } else {
            assert.strictEqual(Object.hasOwn(request, 'stream_options'), false, `${providerType} must not inherit unverified usage options`);
        }
        assert.deepStrictEqual(JSON.parse(JSON.stringify(response.usage)), usage);
        assert.strictEqual(response.choices[0].message.content, '回答');
        const summary = sandbox.createApiTokenUsageSummary(providerType, response.usage);
        assert.strictEqual(sandbox.formatApiTokenUsageSummary(summary), 'Token 用量統計：\n- 輸入：120\n- 輸出：35\n- 總計：155');
        assert.strictEqual(Object.hasOwn(options.requestBody, 'stream_options'), false, 'Do not mutate the caller request');
    }

    const options = {
        providerType: 'ollama-cloud', providerLabel: 'Ollama Cloud', url: 'https://example.invalid/chat/completions',
        requestBody: { model: 'test', stream_options: { include_obfuscation: false, include_usage: false } }, headers: {}
    };
    await sandbox.fetchOpenAIChatCompletionsStream(options);
    assert.strictEqual(request.stream_options.include_usage, true);
    assert.strictEqual(request.stream_options.include_obfuscation, false);
    assert.strictEqual(options.requestBody.stream_options.include_usage, false);

    chunks = [{ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }];
    const withoutUsage = await sandbox.fetchOpenAIChatCompletionsStream(options);
    assert.strictEqual(withoutUsage.usage, null, 'Missing upstream usage must not become fabricated zero counts');
    assert.strictEqual(sandbox.formatApiTokenUsageSummary(sandbox.createApiTokenUsageSummary('Ollama Cloud', withoutUsage.usage)), '');

    chunks = [{ type: 'response.completed', response: { id: 'test', usage: { input_tokens: 120, output_tokens: 35, total_tokens: 155 }, output: [] } }];
    const responsesResult = await sandbox.fetchResponsesApiStream({ ...options, requestBody: { model: 'test', input: 'test' } });
    assert.strictEqual(Object.hasOwn(request, 'stream_options'), false, 'Responses must not inherit Chat Completions options');
    assert.strictEqual(responsesResult.usage.total_tokens, 155);

    // Verify each production caller supplies the stable provider type rather than a display label.
    for (const [name, endName, expected] of [
        ['askOpenAI', 'askAzureOpenAI', /providerType: 'openai'/],
        ['askAzureOpenAI', 'askOpenAICompatible', /providerType: 'azure'/],
        ['askOpenAICompatible', 'formatMessagesForAnthropic', /providerType,/]
    ]) {
        const start = source.indexOf(`async function ${name}(`);
        const end = source.indexOf(`function ${endName}(`, start + 1);
        const section = source.slice(start, end);
        const optionsStart = section.indexOf('const streamOptions = {');
        const optionsEnd = section.indexOf('};', optionsStart);
        assert(optionsStart >= 0 && optionsEnd > optionsStart);
        assert.match(section.slice(optionsStart, optionsEnd), expected, `${name} must forward providerType`);
    }
    console.log('streaming-token-usage: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
