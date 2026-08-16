'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const englishCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, '_locales/en/messages.json'), 'utf8'));

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
    },
    AskPageI18n: {
        t(key) {
            return englishCatalog[key]?.message || key;
        }
    }
};

sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(`${contentScript}\nglobalThis.__askPageTestExports = {
    getProviderTypeLabel,
    getProviderDisplayName,
    getProviderDialogDisplayName
};`, sandbox, {
    filename: 'content.js'
});

const {
    getProviderTypeLabel,
    getProviderDisplayName,
    getProviderDialogDisplayName
} = sandbox.__askPageTestExports;

// getProviderTypeLabel: maps every known type to its display label.
assert.strictEqual(getProviderTypeLabel('gemini'), 'Google Gemini');
assert.strictEqual(getProviderTypeLabel('vertex-ai'), 'Google Vertex AI');
assert.strictEqual(getProviderTypeLabel('openai'), 'OpenAI');
assert.strictEqual(getProviderTypeLabel('azure'), 'Azure OpenAI');
assert.strictEqual(getProviderTypeLabel('anthropic'), 'Anthropic Claude');
assert.strictEqual(getProviderTypeLabel('deepseek'), 'DeepSeek');
assert.strictEqual(getProviderTypeLabel('openrouter'), 'OpenRouter');
assert.strictEqual(getProviderTypeLabel('groq'), 'Groq');
assert.strictEqual(getProviderTypeLabel('mistral'), 'Mistral AI');
assert.strictEqual(getProviderTypeLabel('ollama'), 'Ollama (Local)');
assert.strictEqual(getProviderTypeLabel('ollama-cloud'), 'Ollama Cloud');
assert.strictEqual(getProviderTypeLabel('openai-compatible'), 'OpenAI-compatible endpoint');
// Unknown types fall back to the OpenAI-compatible endpoint label.
assert.strictEqual(getProviderTypeLabel('unknown-type'), 'OpenAI-compatible endpoint');
assert.strictEqual(getProviderTypeLabel(undefined), 'OpenAI-compatible endpoint');

// getProviderDisplayName: custom name differs from type label -> `typeLabel (customName)`.
assert.strictEqual(
    getProviderDisplayName({ type: 'openai-compatible', name: 'CLI Proxy API' }),
    'OpenAI-compatible endpoint (CLI Proxy API)'
);
assert.strictEqual(
    getProviderDisplayName({ type: 'gemini', name: '我的 Gemini 帳號' }),
    'Google Gemini (我的 Gemini 帳號)'
);
assert.strictEqual(
    getProviderDisplayName({ type: 'vertex-ai', name: '工作用 Vertex' }),
    'Google Vertex AI (工作用 Vertex)'
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
    'Google Gemini'
);
assert.strictEqual(
    getProviderDisplayName({ type: 'anthropic', name: 'Anthropic Claude' }),
    'Anthropic Claude'
);
assert.strictEqual(
    getProviderDisplayName({ type: 'ollama', name: 'Ollama (Local)' }),
    'Ollama (Local)'
);

// Empty or missing custom name -> only the type label is shown.
assert.strictEqual(getProviderDisplayName({ type: 'gemini', name: '' }), 'Google Gemini');
assert.strictEqual(getProviderDisplayName({ type: 'gemini' }), 'Google Gemini');
assert.strictEqual(getProviderDisplayName({ type: 'openai-compatible', name: '   ' }), 'OpenAI-compatible endpoint');

// Missing config -> falls back to the OpenAI Compatible label.
assert.strictEqual(getProviderDisplayName(null), 'OpenAI-compatible endpoint');
assert.strictEqual(getProviderDisplayName(undefined), 'OpenAI-compatible endpoint');
assert.strictEqual(getProviderDisplayName({}), 'OpenAI-compatible endpoint');

// Main dialog: prefer the custom name without prefixing the provider type.
assert.strictEqual(
    getProviderDialogDisplayName({ type: 'gemini', name: 'GOOGLE' }),
    'GOOGLE'
);
assert.strictEqual(
    getProviderDialogDisplayName({ type: 'openai-compatible', name: 'CLI Proxy API' }),
    'CLI Proxy API'
);

// Main dialog: missing custom names fall back to the localized provider type.
assert.strictEqual(getProviderDialogDisplayName({ type: 'gemini', name: '' }), 'Google Gemini');
assert.strictEqual(getProviderDialogDisplayName({ type: 'openai' }), 'OpenAI');
assert.strictEqual(getProviderDialogDisplayName(null), 'OpenAI-compatible endpoint');

console.log('provider-display-name: ok');
