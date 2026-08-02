'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const backgroundScript = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');
const anthropicSectionStart = contentScript.indexOf('async function askAnthropic');
const anthropicSection = contentScript.slice(anthropicSectionStart);

assert.notStrictEqual(anthropicSectionStart, -1);
assert.match(contentScript, /const ANTHROPIC_API_ORIGIN = 'https:\/\/api\.anthropic\.com';/);
assert.match(contentScript, /new Set\(\['messages'\]\)/);
assert.match(contentScript, /function createAnthropicServiceWorkerFetch\(apiKey\)/);
assert.match(contentScript, /providerType: 'anthropic'/);
assert.match(contentScript, /providerType,\s*endpoint,\s*apiKey:\s*normalizedApiKey,\s*requestBody/);
assert.match(contentScript, /async function fetchAnthropicStream\(\{[\s\S]*?fetchImpl = fetch,[\s\S]*?fetchSseWithRetry\(\{[\s\S]*?fetchImpl,\s*onEvent:/);
assert.match(anthropicSection, /const providerFetch = createAnthropicServiceWorkerFetch\(apiKey\);/);
assert.match(anthropicSection, /fetchAnthropicStream\(\{[\s\S]*?fetchImpl: providerFetch/);
assert.match(anthropicSection, /fetchJsonWithRetry\(\{[\s\S]*?fetchImpl: providerFetch/);

assert.match(backgroundScript, /const LLM_API_FETCH_PORT = 'ollama-cloud-fetch';/);
assert.match(backgroundScript, /const ANTHROPIC_API_BASE_URL = 'https:\/\/api\.anthropic\.com\/v1';/);
assert.match(backgroundScript, /new Set\(\['messages'\]\)/);
assert.match(backgroundScript, /anthropic:\s*\{[\s\S]*?baseUrl: ANTHROPIC_API_BASE_URL/);
assert.match(backgroundScript, /'x-api-key': apiKey/);
assert.match(backgroundScript, /'anthropic-version': '2023-06-01'/);
assert.match(backgroundScript, /'anthropic-dangerous-direct-browser-access': 'true'/);
assert.match(backgroundScript, /providerConfig\.baseUrl \+ '\/' \+ endpoint/);
assert.match(anthropicSection, /const parsedError = parseApiErrorBody\(errorBody\);/);
assert.match(anthropicSection, /\$\{providerLabel\} 驗證失敗：\$\{parsedError\.apiMessage\}/);

console.log('anthropic-service-worker-provider: ok');
