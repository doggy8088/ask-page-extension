'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');

const sandbox = {
    console,
    chrome: {
        runtime: {
            getURL(resourcePath) {
                return resourcePath;
            },
            onMessage: {
                addListener() {}
            },
            sendMessage() {}
        },
        storage: {
            local: {
                get() {
                    return Promise.resolve({});
                },
                set() {
                    return Promise.resolve();
                }
            }
        }
    },
    document: {
        readyState: 'complete'
    },
    window: {
        location: {
            href: 'about:blank'
        }
    }
};

sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${contentScript}\nglobalThis.__streamingModeTestExports = {
    STREAMING_PROVIDER_CAPABILITIES,
    isStreamingSupported
};`, sandbox, {
    filename: 'content.js'
});

const {
    STREAMING_PROVIDER_CAPABILITIES,
    isStreamingSupported
} = sandbox.__streamingModeTestExports;

assert.deepStrictEqual(Object.keys(STREAMING_PROVIDER_CAPABILITIES).sort(), [
    'anthropic',
    'azure',
    'deepseek',
    'gemini',
    'groq',
    'mistral',
    'ollama',
    'ollama-cloud',
    'openai',
    'openrouter'
]);

[
    ['gemini', 'gemini-3.8-flash'],
    ['openai', 'gpt-5.6-sol'],
    ['azure', 'production-gpt-5.6'],
    ['anthropic', 'claude-sonnet-4-6'],
    ['deepseek', 'deepseek-v4-flash'],
    ['openrouter', 'qwen/qwen3.7-max'],
    ['groq', 'llama-3.3-70b-versatile'],
    ['mistral', 'mistral-large-latest'],
    ['ollama', 'llama3.2'],
    ['ollama-cloud', 'gpt-oss:120b']
].forEach(([providerType, model]) => {
    assert.strictEqual(
        isStreamingSupported(providerType, model),
        true,
        `${providerType}/${model} should support streaming`
    );
});

assert.strictEqual(isStreamingSupported('deepseek', 'deepseek-chat'), false);
assert.strictEqual(isStreamingSupported('openai-compatible', 'gpt-4o'), false);
assert.strictEqual(isStreamingSupported('openrouter', ''), false);
assert.strictEqual(isStreamingSupported('unknown-provider', 'some-model'), false);

const geminiLoopSection = contentScript.slice(
    contentScript.indexOf('async function runGeminiToolLoop'),
    contentScript.indexOf('async function askGemini')
);
assert.match(geminiLoopSection, /responseData = streamingEnabled\s*\n\s*\? await fetchGeminiStream/);

[
    ['askOpenAI', 'askAzureOpenAI', /isStreamingSupported\('openai'/],
    ['askAzureOpenAI', 'askOpenAICompatible', /isStreamingSupported\('azure'/],
    ['askOpenAICompatible', 'function formatMessagesForAnthropic', /isStreamingSupported\(providerType,/],
    ['askAnthropic', 'askAI', /isStreamingSupported\('anthropic'/]
].forEach(([startName, endName, capabilityPattern]) => {
    const start = contentScript.indexOf(`async function ${startName}`);
    const endMarker = endName.startsWith('function ')
        ? `    ${endName}`
        : `    async function ${endName}`;
    const end = contentScript.indexOf(endMarker, start + 1);
    const section = contentScript.slice(start, end === -1 ? undefined : end);

    assert.notStrictEqual(start, -1, `${startName} should exist`);
    assert.match(section, capabilityPattern);
    assert.match(section, /if \(streamingEnabled\)/);
});

assert.match(contentScript, /onAnswerDelta: streamingEnabled \? \(delta\) => streamedAnswer\.append\(delta\)/);
assert.match(contentScript, /finalAnswer = agentModeEnabled\s*\n\s*\? getLocalizedText\('agentToolFallbackMessage'/);
assert.match(contentScript, /const finalAnswer = answer\.fallbackUsed\s*\n\s*\? getLocalizedText\('endpointToolFallbackMessage'/);

console.log('streaming-mode: ok');
