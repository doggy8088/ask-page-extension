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
    getProviderTypeLabel,
    getProviderDisplayName
};`, sandbox, {
    filename: 'content.js'
});

const {
    getProviderTypeLabel,
    getProviderDisplayName
} = sandbox.__askPageTestExports;

// getProviderTypeLabel: maps every known type to its display label.
assert.strictEqual(getProviderTypeLabel('gemini'), 'Gemini');
assert.strictEqual(getProviderTypeLabel('openai'), 'OpenAI');
assert.strictEqual(getProviderTypeLabel('azure'), 'Azure OpenAI');
assert.strictEqual(getProviderTypeLabel('anthropic'), 'Anthropic');
assert.strictEqual(getProviderTypeLabel('deepseek'), 'DeepSeek');
assert.strictEqual(getProviderTypeLabel('openrouter'), 'OpenRouter');
assert.strictEqual(getProviderTypeLabel('groq'), 'Groq');
assert.strictEqual(getProviderTypeLabel('mistral'), 'Mistral AI');
assert.strictEqual(getProviderTypeLabel('ollama'), 'Ollama');
assert.strictEqual(getProviderTypeLabel('ollama-cloud'), 'Ollama Cloud');
assert.strictEqual(getProviderTypeLabel('openai-compatible'), 'OpenAI Compatible');
// Unknown types fall back to the OpenAI Compatible label.
assert.strictEqual(getProviderTypeLabel('unknown-type'), 'OpenAI Compatible');
assert.strictEqual(getProviderTypeLabel(undefined), 'OpenAI Compatible');

// getProviderDisplayName: custom name differs from type label -> `typeLabel (customName)`.
assert.strictEqual(
    getProviderDisplayName({ type: 'openai-compatible', name: 'CLI Proxy API' }),
    'OpenAI Compatible (CLI Proxy API)'
);
assert.strictEqual(
    getProviderDisplayName({ type: 'gemini', name: '我的 Gemini 帳號' }),
    'Gemini (我的 Gemini 帳號)'
);
assert.strictEqual(
    getProviderDisplayName({ type: 'ollama-cloud', name: 'My Ollama' }),
    'Ollama Cloud (My Ollama)'
);

// Custom name equals the type label -> only the type label is shown.
assert.strictEqual(
    getProviderDisplayName({ type: 'ollama-cloud', name: 'Ollama Cloud' }),
    'Ollama Cloud'
);
assert.strictEqual(
    getProviderDisplayName({ type: 'deepseek', name: 'DeepSeek' }),
    'DeepSeek'
);

// Custom name equals the built-in default name -> only the type label is shown,
// avoiding redundant labels like "Gemini (Google Gemini)".
assert.strictEqual(
    getProviderDisplayName({ type: 'gemini', name: 'Google Gemini' }),
    'Gemini'
);
assert.strictEqual(
    getProviderDisplayName({ type: 'anthropic', name: 'Anthropic Claude' }),
    'Anthropic'
);
assert.strictEqual(
    getProviderDisplayName({ type: 'ollama', name: 'Ollama (Local)' }),
    'Ollama'
);

// Empty or missing custom name -> only the type label is shown.
assert.strictEqual(getProviderDisplayName({ type: 'gemini', name: '' }), 'Gemini');
assert.strictEqual(getProviderDisplayName({ type: 'gemini' }), 'Gemini');
assert.strictEqual(getProviderDisplayName({ type: 'openai-compatible', name: '   ' }), 'OpenAI Compatible');

// Missing config -> falls back to the OpenAI Compatible label.
assert.strictEqual(getProviderDisplayName(null), 'OpenAI Compatible');
assert.strictEqual(getProviderDisplayName(undefined), 'OpenAI Compatible');
assert.strictEqual(getProviderDisplayName({}), 'OpenAI Compatible');

console.log('provider-display-name: ok');
