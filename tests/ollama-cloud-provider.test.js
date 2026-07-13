'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const settingsScript = fs.readFileSync(path.join(rootDir, 'settings.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(rootDir, 'settings.html'), 'utf8');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const backgroundScript = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');

const sandbox = {
    console,
    document: {
        addEventListener() {}
    }
};

sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${settingsScript}\nglobalThis.__ollamaCloudModels = PREDEFINED_MODELS['ollama-cloud'];`, sandbox, {
    filename: 'settings.js'
});

const expectedModels = [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'glm-5.2',
    'gpt-oss:120b',
    'kimi-k2.7-code',
    'minimax-m3'
];

const actualModels = Array.from(sandbox.__ollamaCloudModels);
assert.deepStrictEqual(actualModels, expectedModels);
assert.strictEqual(new Set(actualModels).size, actualModels.length);

assert.match(settingsHtml, /<option value="ollama-cloud">Ollama Cloud<\/option>/);
assert.match(settingsHtml, /id="modalOllamaCloudApiKey"/);
assert.match(settingsHtml, /id="modalOllamaCloudModelsList"/);
assert.match(settingsHtml, /data-provider-type="ollama-cloud" data-action="fetch-models"/);

assert.match(settingsScript, /url = 'https:\/\/ollama\.com\/v1\/models';/);
assert.match(settingsScript, /headers\['Authorization'\] = `Bearer \$\{apiKey\}`;/);
assert.match(contentScript, /providerType === 'ollama-cloud'/);
assert.match(contentScript, /endpoint = 'https:\/\/ollama\.com\/v1';/);
assert.match(contentScript, /'ollama-cloud'\]\.includes\(activeConfig\.type\)/);
assert.match(contentScript, /chrome\.runtime\.connect\(\{ name: OLLAMA_CLOUD_FETCH_PORT \}\)/);
assert.match(contentScript, /createOllamaCloudServiceWorkerFetch\(apiKey\)/);
assert.match(contentScript, /fetchImpl: providerFetch/);

assert.match(backgroundScript, /chrome\.runtime\.onConnect\.addListener/);
assert.match(backgroundScript, /const OLLAMA_CLOUD_API_BASE_URL = 'https:\/\/ollama\.com\/v1';/);
assert.match(backgroundScript, /new Set\(\['chat\/completions', 'responses'\]\)/);
assert.match(backgroundScript, /'Authorization': `Bearer \$\{apiKey\}`/);

console.log('ollama-cloud-provider: ok');
