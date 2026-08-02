'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const styleSheet = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');

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
vm.runInContext(`${contentScript}\nglobalThis.__askPageTestExports = {
    GEMINI_REASONING_CAPABILITIES,
    GEMMA_4_REASONING_CAPABILITY,
    OPENAI_REASONING_CAPABILITIES,
    OLLAMA_CLOUD_DEEPSEEK_V4_REASONING_CAPABILITY,
    pendingReasoningValues,
    getReasoningCapability,
    setActiveReasoningValue,
    normalizeReasoningValue,
    getReasoningSliderConfig,
    getReasoningValueFromSlider,
    buildGeminiThinkingConfig,
    applyOpenAIReasoningEffort
};`, sandbox, {
    filename: 'content.js'
});

const {
    GEMINI_REASONING_CAPABILITIES,
    GEMMA_4_REASONING_CAPABILITY,
    OPENAI_REASONING_CAPABILITIES,
    OLLAMA_CLOUD_DEEPSEEK_V4_REASONING_CAPABILITY,
    pendingReasoningValues,
    getReasoningCapability,
    setActiveReasoningValue,
    normalizeReasoningValue,
    getReasoningSliderConfig,
    getReasoningValueFromSlider,
    buildGeminiThinkingConfig,
    applyOpenAIReasoningEffort
} = sandbox.__askPageTestExports;

function capabilityOptions(providerType, model) {
    const capability = getReasoningCapability(providerType, model);
    return capability ? Array.from(capability.options || []) : null;
}

assert.deepStrictEqual(Array.from(Object.keys(GEMINI_REASONING_CAPABILITIES)).sort(), [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash'
]);

assert.deepStrictEqual(Array.from(Object.keys(OPENAI_REASONING_CAPABILITIES)).sort(), [
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5.1',
    'gpt-5.2',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.4-pro',
    'gpt-5.5',
    'gpt-5.5-pro',
    'gpt-5.6',
    'gpt-5.6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'o3',
    'o3-mini',
    'o4-mini'
]);

// Gemini 3.x exposes only the thinking levels documented for each exact model.
assert.deepStrictEqual(capabilityOptions('gemini', 'gemini-3.6-flash'), ['minimal', 'low', 'medium', 'high']);
assert.deepStrictEqual(capabilityOptions('gemini', 'gemini-3.5-flash-lite'), ['minimal', 'low', 'medium', 'high']);
assert.deepStrictEqual(capabilityOptions('gemini', 'gemini-3.1-pro-preview'), ['low', 'medium', 'high']);
assert.deepStrictEqual(capabilityOptions('gemini', 'gemini-3-pro-preview'), ['low', 'high']);
assert.strictEqual(getReasoningCapability('gemini', 'gemini-3.1-pro-preview').defaultValue, 'high');
assert.strictEqual(getReasoningCapability('gemini', 'gemini-flash-lite-latest'), null);
assert.strictEqual(
    normalizeReasoningValue(getReasoningCapability('gemini', 'gemini-3.1-pro-preview'), 'minimal'),
    'high'
);

// Gemma 4 on the Gemini API exposes minimal (off) and high (on) through thinkingLevel.
assert.deepStrictEqual(Array.from(GEMMA_4_REASONING_CAPABILITY.options), ['minimal', 'high']);
assert.strictEqual(GEMMA_4_REASONING_CAPABILITY.defaultValue, 'high');
assert.deepStrictEqual(capabilityOptions('gemini', 'gemma-4-31b-it'), ['minimal', 'high']);
assert.deepStrictEqual(capabilityOptions('gemini', 'gemma-4-26b-a4b-it'), ['minimal', 'high']);
assert.deepStrictEqual(capabilityOptions('gemini', 'gemma-4-31b-it-2026-08-02'), ['minimal', 'high']);
assert.strictEqual(getReasoningCapability('gemini', 'gemma-4'), null);
assert.strictEqual(getReasoningCapability('gemini', 'gemini-4-flash'), null);
assert.strictEqual(getReasoningCapability('openrouter', 'google/gemma-4-31b-it'), null);
assert.strictEqual(
    normalizeReasoningValue(getReasoningCapability('gemini', 'gemma-4-31b-it'), 'medium'),
    'high'
);

// Gemini 2.5 keeps the exact GenerateContent thinking-budget ranges and special modes.
const gemini25Pro = getReasoningCapability('gemini', 'gemini-2.5-pro');
assert.strictEqual(gemini25Pro.minBudget, 128);
assert.strictEqual(gemini25Pro.maxBudget, 32768);
assert.strictEqual(gemini25Pro.allowOff, false);
assert.strictEqual(gemini25Pro.allowDynamic, true);
assert.strictEqual(gemini25Pro.defaultValue, -1);

const gemini25FlashLite = getReasoningCapability('gemini', 'gemini-2.5-flash-lite');
assert.strictEqual(gemini25FlashLite.minBudget, 512);
assert.strictEqual(gemini25FlashLite.maxBudget, 24576);
assert.strictEqual(gemini25FlashLite.allowOff, true);
assert.strictEqual(gemini25FlashLite.defaultValue, 0);

const gemini25Flash = getReasoningCapability('gemini', 'gemini-2.5-flash');
assert.strictEqual(gemini25Flash.minBudget, 0);
assert.strictEqual(gemini25Flash.maxBudget, 24576);
assert.strictEqual(gemini25Flash.allowOff, true);
assert.strictEqual(gemini25Flash.allowDynamic, true);
assert.strictEqual(gemini25Flash.defaultValue, -1);

const proSlider = getReasoningSliderConfig(gemini25Pro, -1);
assert.strictEqual(getReasoningValueFromSlider(gemini25Pro, proSlider.min), 128);
assert.strictEqual(getReasoningValueFromSlider(gemini25Pro, proSlider.max), -1);

const flashLiteSlider = getReasoningSliderConfig(gemini25FlashLite, 0);
assert.strictEqual(flashLiteSlider.index, 0);
assert.strictEqual(getReasoningValueFromSlider(gemini25FlashLite, 0), 0);
assert.strictEqual(getReasoningValueFromSlider(gemini25FlashLite, 1), 512);
assert.strictEqual(getReasoningValueFromSlider(gemini25FlashLite, flashLiteSlider.max), -1);
assert.strictEqual(normalizeReasoningValue(gemini25FlashLite, 511), 0);
assert.strictEqual(normalizeReasoningValue(gemini25FlashLite, 24576), 24576);

// OpenAI options follow the model-specific subsets documented by OpenAI.
assert.deepStrictEqual(capabilityOptions('openai', 'gpt-5.6-sol'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
assert.deepStrictEqual(capabilityOptions('openai', 'gpt-5.5'), ['none', 'low', 'medium', 'high', 'xhigh']);
assert.deepStrictEqual(capabilityOptions('openai', 'gpt-5.4-nano'), ['none', 'low', 'medium', 'high', 'xhigh']);
assert.deepStrictEqual(capabilityOptions('openai', 'gpt-5.4-pro'), ['medium', 'high', 'xhigh']);
assert.deepStrictEqual(capabilityOptions('openai', 'gpt-5.1'), ['none', 'low', 'medium', 'high']);
assert.deepStrictEqual(capabilityOptions('openai', 'gpt-5-mini'), ['minimal', 'low', 'medium', 'high']);
assert.deepStrictEqual(capabilityOptions('openai', 'o3'), ['low', 'medium', 'high']);
assert.deepStrictEqual(capabilityOptions('openai', 'o4-mini-2025-04-16'), ['low', 'medium', 'high']);
assert.strictEqual(
    normalizeReasoningValue(getReasoningCapability('openai', 'gpt-5.5'), 'max'),
    'medium'
);

// Ollama Cloud DeepSeek V4 models expose only the provider's verified High and Max modes.
assert.deepStrictEqual(Array.from(OLLAMA_CLOUD_DEEPSEEK_V4_REASONING_CAPABILITY.options), ['high', 'max']);
assert.strictEqual(OLLAMA_CLOUD_DEEPSEEK_V4_REASONING_CAPABILITY.defaultValue, 'high');
assert.deepStrictEqual(capabilityOptions('ollama-cloud', 'deepseek-v4-flash:0731-cloud'), ['high', 'max']);
assert.deepStrictEqual(capabilityOptions('ollama-cloud', 'deepseek-v4-flash'), ['high', 'max']);
assert.deepStrictEqual(capabilityOptions('ollama-cloud', 'deepseek-v4-pro'), ['high', 'max']);
assert.strictEqual(getReasoningCapability('ollama-cloud', 'deepseek-v3.1:cloud'), null);
assert.strictEqual(getReasoningCapability('ollama', 'deepseek-v4-flash:cloud'), null);
assert.strictEqual(
    normalizeReasoningValue(getReasoningCapability('ollama-cloud', 'deepseek-v4-pro'), 'low'),
    'high'
);

// Undocumented models and providers that cannot guarantee OpenAI parameter compatibility stay hidden.
assert.strictEqual(getReasoningCapability('openai', 'gpt-5.3'), null);
assert.strictEqual(getReasoningCapability('openai', 'gpt-4.1'), null);
assert.strictEqual(getReasoningCapability('azure', 'gpt-5.6-sol'), null);
assert.strictEqual(getReasoningCapability('openrouter', 'openai/gpt-5.6-sol'), null);
assert.strictEqual(getReasoningCapability('openai-compatible', 'gpt-5.6-sol'), null);

// Request parameters use the provider endpoint's exact field shape.
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildGeminiThinkingConfig('gemini-3.6-flash', 'high', true))),
    { includeThoughts: true, thinkingLevel: 'high' }
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildGeminiThinkingConfig('gemini-3.1-pro-preview', null, false))),
    { thinkingLevel: 'high' }
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildGeminiThinkingConfig('gemini-2.5-flash', 0, false))),
    { thinkingBudget: 0 }
);
assert.strictEqual(buildGeminiThinkingConfig('gemini-flash-lite-latest', 'medium', true), null);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildGeminiThinkingConfig('gemma-4-31b-it', 'minimal', false))),
    { thinkingLevel: 'minimal' }
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildGeminiThinkingConfig('gemma-4-26b-a4b-it', null, true))),
    { includeThoughts: true, thinkingLevel: 'high' }
);

const responsesBody = applyOpenAIReasoningEffort({ model: 'gpt-5.6-sol' }, 'xhigh', true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(responsesBody)), {
    model: 'gpt-5.6-sol',
    reasoning: { effort: 'xhigh' }
});
const chatBody = applyOpenAIReasoningEffort({ model: 'o3' }, 'high', false);
assert.deepStrictEqual(JSON.parse(JSON.stringify(chatBody)), {
    model: 'o3',
    reasoning_effort: 'high'
});
const ollamaCloudChatBody = applyOpenAIReasoningEffort({ model: 'deepseek-v4-flash:0731-cloud' }, 'max', false);
assert.deepStrictEqual(JSON.parse(JSON.stringify(ollamaCloudChatBody)), {
    model: 'deepseek-v4-flash:0731-cloud',
    reasoning_effort: 'max'
});
assert.match(contentScript, /applyOpenAIReasoningEffort\(requestBody, reasoningEffort, false\);/);

// The main dialog owns the hover/focus popover and native range input.
assert.match(contentScript, /reasoningSlider\.type = 'range';/);
assert.match(contentScript, /await setActiveReasoningValue\(activeConfig, value\);/);
assert.match(contentScript, /pendingReasoningValues\.delete\(settingKey\);/);
assert.match(styleSheet, /\.askpage-provider-model-control\[data-reasoning-configurable="true"\]:hover \.askpage-reasoning-popover/);
assert.match(styleSheet, /\.askpage-reasoning-slider::-webkit-slider-thumb/);

(async () => {
    const activeConfig = {
        id: 'ollama-cloud-test',
        type: 'ollama-cloud',
        activeModel: 'deepseek-v4-pro'
    };
    const settingKey = JSON.stringify([activeConfig.id, activeConfig.activeModel]);
    pendingReasoningValues.set(settingKey, 'max');
    assert.strictEqual(await setActiveReasoningValue(activeConfig, 'high'), 'high');
    assert.strictEqual(pendingReasoningValues.has(settingKey), false);
    console.log('reasoning-effort: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
