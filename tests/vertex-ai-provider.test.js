'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const settingsScript = fs.readFileSync(path.join(rootDir, 'settings.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(rootDir, 'settings.html'), 'utf8');

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
vm.runInContext(`${contentScript}\nglobalThis.__vertexAiTestExports = {
    buildGeminiApiUrl
};`, sandbox, {
    filename: 'content.js'
});

const { buildGeminiApiUrl } = sandbox.__vertexAiTestExports;

assert.strictEqual(
    buildGeminiApiUrl('vertex-ai', 'gemini-3.6-flash', 'generateContent', 'test key'),
    'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.6-flash:generateContent?key=test%20key'
);
assert.strictEqual(
    buildGeminiApiUrl('vertex-ai', 'gemini-3.6-flash', 'streamGenerateContent', 'test-key', true),
    'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.6-flash:streamGenerateContent?alt=sse&key=test-key'
);
assert.strictEqual(
    buildGeminiApiUrl('gemini', 'gemini-3.6-flash', 'generateContent', 'test-key'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=test-key'
);

assert.match(settingsHtml, /<option value="vertex-ai"[^>]*data-i18n="providerVertexAI"/);
assert.match(settingsHtml, /id="modalVertexAiApiKey"[^>]*type="password"/);
assert.match(settingsHtml, /data-provider-type="vertex-ai" data-action="add-custom-model"/);
assert.match(settingsHtml, /id="modalVertexAiModelsList"/);

assert.match(settingsScript, /'vertex-ai': \[[\s\S]*?'gemini-3\.6-flash'/);
assert.match(settingsScript, /modalVertexAiModelsList\.querySelectorAll\('input\[type="checkbox"\]:checked'\)/);
assert.match(settingsScript, /modalVertexAiApiKey\.value\.trim\(\)/);
assert.match(settingsScript, /aiplatform\.googleapis\.com\/v1\/publishers\/google\/models\/\$\{selectedModel\}:generateContent\?key=\$\{apiKey\}/);

assert.match(contentScript, /const providerType = activeConfig\?\.type === 'vertex-ai' \? 'vertex-ai' : 'gemini';/);
assert.match(contentScript, /buildGeminiApiUrl\(providerType, selectedModel, 'streamGenerateContent', apiKey, true\)/);
assert.match(contentScript, /buildGeminiApiUrl\(providerType, selectedModel, 'generateContent', apiKey\)/);

console.log('vertex-ai-provider: ok');
