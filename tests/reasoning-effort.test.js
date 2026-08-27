'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const settingsScript = fs.readFileSync(path.join(rootDir, 'settings.js'), 'utf8');
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
    ANTHROPIC_REASONING_CAPABILITIES,
    AZURE_REASONING_MODEL_IDS,
    DEEPSEEK_REASONING_CAPABILITIES,
    OPENROUTER_REASONING_CAPABILITIES,
    OLLAMA_CLOUD_DEEPSEEK_V4_REASONING_CAPABILITY,
    OLLAMA_CLOUD_GLM_5_2_REASONING_CAPABILITY,
    OLLAMA_CLOUD_KIMI_K2_7_CODE_REASONING_CAPABILITY,
    pendingReasoningValues,
    getReasoningCapability,
    setActiveReasoningValue,
    normalizeReasoningValue,
    getReasoningSliderConfig,
    getReasoningValueFromSlider,
    buildGeminiThinkingConfig,
    buildAnthropicThinkingConfig,
    getAnthropicMaxOutputTokens,
    applyOpenAIReasoningEffort,
    applyDeepSeekReasoningConfig
};`, sandbox, {
    filename: 'content.js'
});

const {
    GEMINI_REASONING_CAPABILITIES,
    GEMMA_4_REASONING_CAPABILITY,
    OPENAI_REASONING_CAPABILITIES,
    ANTHROPIC_REASONING_CAPABILITIES,
    AZURE_REASONING_MODEL_IDS,
    DEEPSEEK_REASONING_CAPABILITIES,
    OPENROUTER_REASONING_CAPABILITIES,
    OLLAMA_CLOUD_DEEPSEEK_V4_REASONING_CAPABILITY,
    OLLAMA_CLOUD_GLM_5_2_REASONING_CAPABILITY,
    OLLAMA_CLOUD_KIMI_K2_7_CODE_REASONING_CAPABILITY,
    pendingReasoningValues,
    getReasoningCapability,
    setActiveReasoningValue,
    normalizeReasoningValue,
    getReasoningSliderConfig,
    getReasoningValueFromSlider,
    buildGeminiThinkingConfig,
    buildAnthropicThinkingConfig,
    getAnthropicMaxOutputTokens,
    applyOpenAIReasoningEffort,
    applyDeepSeekReasoningConfig
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
    'gemini-3.6-flash',
    'gemini-3.7-flash'
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
assert.deepStrictEqual(capabilityOptions('gemini', 'gemini-3.7-flash'), ['minimal', 'low', 'medium', 'high']);
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

// Gemma 4 exposes an explicit UI-level Off option that maps to the API's minimal value.
assert.deepStrictEqual(Array.from(GEMMA_4_REASONING_CAPABILITY.options), ['none', 'high']);
assert.strictEqual(GEMMA_4_REASONING_CAPABILITY.defaultValue, 'high');
assert.deepStrictEqual(capabilityOptions('gemini', 'gemma-4-31b-it'), ['none', 'high']);
assert.deepStrictEqual(capabilityOptions('gemini', 'gemma-4-26b-a4b-it'), ['none', 'high']);
assert.deepStrictEqual(capabilityOptions('gemini', 'gemma-4-31b-it-2026-08-02'), ['none', 'high']);
assert.strictEqual(getReasoningCapability('gemini', 'gemma-4'), null);
assert.strictEqual(getReasoningCapability('gemini', 'gemini-4-flash'), null);
assert.strictEqual(getReasoningCapability('openrouter', 'google/gemma-4-31b-it'), null);
assert.strictEqual(
    normalizeReasoningValue(getReasoningCapability('gemini', 'gemma-4-31b-it'), 'minimal'),
    'none'
);

// Gemini 2.5 keeps the exact GenerateContent thinking-budget ranges and special modes.
const gemini25Pro = getReasoningCapability('gemini', 'gemini-2.5-pro');
assert.strictEqual(gemini25Pro.minBudget, 128);
assert.strictEqual(gemini25Pro.maxBudget, 32768);
assert.strictEqual(gemini25Pro.allowOff, false);
assert.strictEqual(gemini25Pro.allowDynamic, true);
assert.strictEqual(gemini25Pro.defaultValue, 32768);

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
assert.strictEqual(gemini25Flash.defaultValue, 24576);

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
Object.entries(OPENAI_REASONING_CAPABILITIES).forEach(([model, capability]) => {
    assert.strictEqual(capability.defaultValue, 'medium', `${model} should default to medium`);
});
assert.strictEqual(
    normalizeReasoningValue(getReasoningCapability('openai', 'gpt-5.5'), 'max'),
    'medium'
);

// Anthropic models use adaptive effort or a manual thinking-token budget, with explicit Off.
assert.deepStrictEqual(Array.from(Object.keys(ANTHROPIC_REASONING_CAPABILITIES)).sort(), [
    'claude-haiku-4-5',
    'claude-opus-4-7',
    'claude-sonnet-4-6'
]);
assert.deepStrictEqual(capabilityOptions('anthropic', 'claude-opus-4-7'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
assert.deepStrictEqual(capabilityOptions('anthropic', 'claude-sonnet-4-6'), ['none', 'low', 'medium', 'high', 'max']);
assert.strictEqual(getReasoningCapability('anthropic', 'claude-opus-4-7').defaultValue, 'high');
assert.strictEqual(getReasoningCapability('anthropic', 'claude-sonnet-4-6').defaultValue, 'high');
const claudeHaiku45 = getReasoningCapability('anthropic', 'claude-haiku-4-5');
assert.strictEqual(claudeHaiku45.kind, 'budget');
assert.strictEqual(claudeHaiku45.minBudget, 1024);
assert.strictEqual(claudeHaiku45.maxBudget, 32768);
assert.strictEqual(claudeHaiku45.allowOff, true);
assert.strictEqual(claudeHaiku45.allowDynamic, false);
assert.strictEqual(claudeHaiku45.defaultValue, 0);
Object.entries(ANTHROPIC_REASONING_CAPABILITIES).forEach(([model, capability]) => {
    const expectedDefault = model.startsWith('claude-haiku-') ? 0 : 'high';
    assert.strictEqual(capability.defaultValue, expectedDefault, `${model} has the wrong default`);
});

// Azure resolves the longest OpenAI model prefix in a deployment name.
assert.deepStrictEqual(
    Array.from(AZURE_REASONING_MODEL_IDS).sort(),
    Array.from(Object.keys(OPENAI_REASONING_CAPABILITIES)).sort()
);
assert.deepStrictEqual(capabilityOptions('azure', 'gpt-5.6'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
assert.deepStrictEqual(capabilityOptions('azure', 'gpt-5.6-luna'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
assert.deepStrictEqual(capabilityOptions('azure', 'gpt-5.6-luna-production'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
assert.deepStrictEqual(capabilityOptions('azure', 'gpt-5.5-pro-production'), ['medium', 'high', 'xhigh']);
assert.strictEqual(getReasoningCapability('azure', 'gpt-5.4').defaultValue, 'medium');
assert.strictEqual(getReasoningCapability('azure', 'gpt-5.4-2026-08-02').defaultValue, 'medium');
assert.strictEqual(getReasoningCapability('azure', 'production-gpt-5.6'), null);
assert.strictEqual(getReasoningCapability('azure', 'gpt-5.6luna'), null);

// Current DeepSeek V4 models expose explicit non-thinking mode.
assert.deepStrictEqual(Array.from(Object.keys(DEEPSEEK_REASONING_CAPABILITIES)).sort(), [
    'deepseek-v4-flash',
    'deepseek-v4-pro'
]);
assert.deepStrictEqual(capabilityOptions('deepseek', 'deepseek-v4-flash'), ['none', 'low', 'high', 'max']);
assert.deepStrictEqual(capabilityOptions('deepseek', 'deepseek-v4-pro'), ['none', 'high', 'max']);
assert.strictEqual(getReasoningCapability('deepseek', 'deepseek-chat'), null);
assert.match(settingsScript, /deepseek:\s*\[\s*'deepseek-v4-flash',\s*'deepseek-v4-pro'\s*\]/);
assert.doesNotMatch(settingsScript, /'deepseek-chat'|'deepseek-reasoner'/);

// OpenRouter model metadata explicitly declares the effort values that include none.
assert.deepStrictEqual(Array.from(Object.keys(OPENROUTER_REASONING_CAPABILITIES)).sort(), [
    'openai/gpt-5.6-luna',
    'openai/gpt-5.6-luna-pro',
    'openai/gpt-5.6-sol',
    'openai/gpt-5.6-sol-pro',
    'openai/gpt-5.6-terra',
    'openai/gpt-5.6-terra-pro',
    'tencent/hy3-preview',
    'x-ai/grok-4.3'
]);
assert.deepStrictEqual(capabilityOptions('openrouter', 'openai/gpt-5.6-sol-pro'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
assert.deepStrictEqual(capabilityOptions('openrouter', 'tencent/hy3-preview'), ['none', 'low', 'high']);
assert.deepStrictEqual(capabilityOptions('openrouter', 'x-ai/grok-4.3'), ['none', 'low', 'medium', 'high']);
assert.strictEqual(getReasoningCapability('openrouter', 'x-ai/grok-4.3').defaultValue, 'low');
assert.strictEqual(getReasoningCapability('openrouter', 'deepseek/deepseek-v4-pro'), null);

// Ollama Cloud DeepSeek V4 models expose explicit Off, High and Max modes.
assert.deepStrictEqual(Array.from(OLLAMA_CLOUD_DEEPSEEK_V4_REASONING_CAPABILITY.options), ['none', 'high', 'max']);
assert.strictEqual(OLLAMA_CLOUD_DEEPSEEK_V4_REASONING_CAPABILITY.defaultValue, 'max');
assert.deepStrictEqual(capabilityOptions('ollama-cloud', 'deepseek-v4-flash'), ['none', 'high', 'max']);
assert.deepStrictEqual(capabilityOptions('ollama-cloud', 'deepseek-v4-pro'), ['none', 'high', 'max']);
assert.strictEqual(getReasoningCapability('ollama-cloud', 'deepseek-v3.1:cloud'), null);
assert.strictEqual(getReasoningCapability('ollama', 'deepseek-v4-flash:cloud'), null);
assert.strictEqual(
    normalizeReasoningValue(getReasoningCapability('ollama-cloud', 'deepseek-v4-pro'), 'low'),
    'max'
);

// Ollama Cloud GLM-5.2 supports explicit Off, High and Max modes, with High as default.
assert.deepStrictEqual(Array.from(OLLAMA_CLOUD_GLM_5_2_REASONING_CAPABILITY.options), ['none', 'high', 'max']);
assert.strictEqual(OLLAMA_CLOUD_GLM_5_2_REASONING_CAPABILITY.defaultValue, 'high');
assert.deepStrictEqual(capabilityOptions('ollama-cloud', 'glm-5.2'), ['none', 'high', 'max']);
assert.deepStrictEqual(capabilityOptions('ollama-cloud', 'glm-5.2:cloud'), ['none', 'high', 'max']);
assert.strictEqual(getReasoningCapability('ollama', 'glm-5.2'), null);

// Ollama Cloud Kimi K2.7 Code supports all five OpenAI-compatible effort values.
assert.deepStrictEqual(Array.from(OLLAMA_CLOUD_KIMI_K2_7_CODE_REASONING_CAPABILITY.options), [
    'none',
    'low',
    'medium',
    'high',
    'max'
]);
assert.strictEqual(OLLAMA_CLOUD_KIMI_K2_7_CODE_REASONING_CAPABILITY.defaultValue, 'high');
assert.deepStrictEqual(capabilityOptions('ollama-cloud', 'kimi-k2.7-code'), ['none', 'low', 'medium', 'high', 'max']);
assert.deepStrictEqual(capabilityOptions('ollama-cloud', 'kimi-k2.7-code:cloud'), ['none', 'low', 'medium', 'high', 'max']);
assert.strictEqual(getReasoningCapability('ollama', 'kimi-k2.7-code'), null);

// Undocumented models and providers that cannot guarantee compatible Off semantics stay hidden.
assert.strictEqual(getReasoningCapability('openai', 'gpt-5.3'), null);
assert.strictEqual(getReasoningCapability('openai', 'gpt-4.1'), null);
assert.deepStrictEqual(capabilityOptions('azure', 'gpt-5.6-sol'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
assert.strictEqual(getReasoningCapability('openrouter', 'qwen/qwen3.7-max'), null);
assert.strictEqual(getReasoningCapability('mistral', 'mistral-small-latest'), null);
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
    JSON.parse(JSON.stringify(buildGeminiThinkingConfig('gemma-4-31b-it', 'none', false))),
    { thinkingLevel: 'minimal' }
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildGeminiThinkingConfig('gemma-4-26b-a4b-it', null, true))),
    { includeThoughts: true, thinkingLevel: 'high' }
);

assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildAnthropicThinkingConfig('claude-opus-4-7', 'none'))),
    { thinking: { type: 'disabled' } }
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildAnthropicThinkingConfig('claude-opus-4-7', 'xhigh'))),
    { thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' } }
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildAnthropicThinkingConfig('claude-sonnet-4-6', 'max'))),
    { thinking: { type: 'adaptive' }, output_config: { effort: 'max' } }
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildAnthropicThinkingConfig('claude-haiku-4-5', 0))),
    { thinking: { type: 'disabled' } }
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(buildAnthropicThinkingConfig('claude-haiku-4-5', 4096))),
    { thinking: { type: 'enabled', budget_tokens: 4096 } }
);
assert.strictEqual(getAnthropicMaxOutputTokens('claude-opus-4-7', 'none'), 4096);
assert.strictEqual(getAnthropicMaxOutputTokens('claude-opus-4-7', 'medium'), 16384);
assert.strictEqual(getAnthropicMaxOutputTokens('claude-haiku-4-5', 4096), 8192);

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
const openAIOffBody = applyOpenAIReasoningEffort({ model: 'gpt-5.4' }, 'none', false);
assert.deepStrictEqual(JSON.parse(JSON.stringify(openAIOffBody)), {
    model: 'gpt-5.4',
    reasoning_effort: 'none'
});
const ollamaCloudChatBody = applyOpenAIReasoningEffort({ model: 'deepseek-v4-flash' }, 'max', false);
assert.deepStrictEqual(JSON.parse(JSON.stringify(ollamaCloudChatBody)), {
    model: 'deepseek-v4-flash',
    reasoning_effort: 'max'
});
const ollamaCloudOffBody = applyOpenAIReasoningEffort({ model: 'deepseek-v4-flash' }, 'none', false);
assert.deepStrictEqual(JSON.parse(JSON.stringify(ollamaCloudOffBody)), {
    model: 'deepseek-v4-flash',
    reasoning_effort: 'none'
});
const ollamaCloudGlmOffBody = applyOpenAIReasoningEffort({ model: 'glm-5.2' }, 'none', false);
assert.deepStrictEqual(JSON.parse(JSON.stringify(ollamaCloudGlmOffBody)), {
    model: 'glm-5.2',
    reasoning_effort: 'none'
});
const deepSeekOffBody = applyDeepSeekReasoningConfig({ model: 'deepseek-v4-flash' }, 'none');
assert.deepStrictEqual(JSON.parse(JSON.stringify(deepSeekOffBody)), {
    model: 'deepseek-v4-flash',
    thinking: { type: 'disabled' }
});
const deepSeekMaxBody = applyDeepSeekReasoningConfig({ model: 'deepseek-v4-pro' }, 'max');
assert.deepStrictEqual(JSON.parse(JSON.stringify(deepSeekMaxBody)), {
    model: 'deepseek-v4-pro',
    thinking: { type: 'enabled' },
    reasoning_effort: 'max'
});
assert.match(contentScript, /applyOpenAIReasoningEffort\(requestBody, reasoningEffort, false\);/);
assert.match(contentScript, /applyDeepSeekReasoningConfig\(requestBody, reasoningEffort\);/);
assert.match(contentScript, /Object\.assign\(requestBody, anthropicThinkingConfig\);/);
assert.match(contentScript, /const isReasoning = Boolean\(getReasoningCapability\('azure', deployment\)\);/);
assert.match(contentScript, /const effectiveReasoningEffort = reasoningEffort \|\| \(isReasoning \? 'medium' : ''\);/);
assert.match(contentScript, /reasoningEffort: effectiveReasoningEffort/);

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
