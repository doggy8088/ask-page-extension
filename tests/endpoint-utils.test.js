'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(rootDir, 'endpoint-utils.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const settingsHtml = fs.readFileSync(path.join(rootDir, 'settings.html'), 'utf8');
const settingsScript = fs.readFileSync(path.join(rootDir, 'settings.js'), 'utf8');
const contentScript = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const releaseWorkflow = fs.readFileSync(path.join(rootDir, '.github/workflows/release.yml'), 'utf8');
const manualBuildWorkflow = fs.readFileSync(path.join(rootDir, '.github/workflows/manual-build.yml'), 'utf8');
const testReleaseScript = fs.readFileSync(path.join(rootDir, 'test-release.sh'), 'utf8');

const sandbox = { URL, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'endpoint-utils.js' });

const endpointUtils = sandbox.AskPageEndpoint;
assert.ok(endpointUtils, 'AskPageEndpoint must be exported');

const { validateEndpoint, validateProviders, validateConfig, isLoopbackOrPrivateHost } = endpointUtils;

function assertValid(endpoint) {
    const result = validateEndpoint(endpoint);
    assert.strictEqual(result.ok, true, `${endpoint} should be valid: ${result.reason}`);
    return result;
}

function assertInvalid(endpoint, reason) {
    const result = validateEndpoint(endpoint);
    assert.strictEqual(result.ok, false, `${endpoint} should be invalid`);
    if (reason) {
        assert.strictEqual(result.reason, reason, `${endpoint} should fail with ${reason}`);
    }
}

assertValid('https://api.example.com/v1');
assertValid('HTTPS://API.EXAMPLE.COM/v1');
assertValid('https://example.com');
assertValid('https://example.com:8443/v1');
assertValid('http://localhost:11434/v1');
assertValid('http://127.0.0.1:11434/v1');
assertValid('http://127.1:11434/v1');
assertValid('http://[::1]:11434/v1');
assertValid('http://10.0.0.5:11434/v1');
assertValid('http://172.16.0.5:11434/v1');
assertValid('http://172.31.255.255:11434/v1');
assertValid('http://192.168.1.5:11434/v1');
assertValid('http://foo.localhost:11434/v1');
assertValid('http://[fd00::1]:11434/v1');

const bareOllama = assertValid('http://localhost:11434');
assert.strictEqual(bareOllama.normalized, 'http://localhost:11434');
assert.strictEqual(`${bareOllama.normalized}/models`, 'http://localhost:11434/models');
assert.strictEqual(`${bareOllama.normalized}/api/tags`, 'http://localhost:11434/api/tags');

const versionedOllama = assertValid('http://localhost:11434/v1/');
assert.strictEqual(versionedOllama.normalized, 'http://localhost:11434/v1');
assert.strictEqual(`${versionedOllama.normalized}/models`, 'http://localhost:11434/v1/models');

const httpsOrigin = assertValid('https://example.com/');
assert.strictEqual(httpsOrigin.normalized, 'https://example.com');

const hashEndpoint = assertValid('https://example.com/#/');
assert.strictEqual(hashEndpoint.normalized, 'https://example.com/#/');

assertInvalid('', 'required');
assertInvalid(null, 'required');
assertInvalid('ftp://example.com', 'invalid');
assertInvalid('file:///etc/passwd', 'invalid');
assertInvalid('data:text/plain,hello', 'invalid');
assertInvalid('javascript:alert(1)', 'invalid');
assertInvalid('//example.com', 'invalid');
assertInvalid('https://user:pass@example.com', 'invalid');
assertInvalid('http://example.com', 'insecure');
assertInvalid('http://169.254.169.254/latest/meta-data', 'insecure');
assertInvalid('http://0.0.0.0:11434', 'insecure');
assertInvalid('http://127.0.0.1.evil.com', 'insecure');
assertInvalid('http://localhost.evil.com', 'insecure');
assertInvalid('http://172.32.0.1', 'insecure');
assertInvalid('http://[fe80::1]', 'insecure');

assert.strictEqual(isLoopbackOrPrivateHost('localhost'), true);
assert.strictEqual(isLoopbackOrPrivateHost('foo.localhost'), true);
assert.strictEqual(isLoopbackOrPrivateHost('127.0.0.1'), true);
assert.strictEqual(isLoopbackOrPrivateHost('127.0.0.1.evil.com'), false);
assert.strictEqual(isLoopbackOrPrivateHost('169.254.169.254'), false);
assert.strictEqual(isLoopbackOrPrivateHost('172.32.0.1'), false);
assert.strictEqual(isLoopbackOrPrivateHost('::1'), true);
assert.strictEqual(isLoopbackOrPrivateHost('fd00::1'), true);
assert.strictEqual(isLoopbackOrPrivateHost('fe80::1'), false);

assert.strictEqual(
    validateProviders([
        { openaiCompatibleEndpoint: 'https://api.example.com/v1' },
        { ollamaEndpoint: 'http://localhost:11434/v1' },
        { azureEndpoint: 'https://example.openai.azure.com' }
    ]).ok,
    true
);

const invalidProviderEndpoint = validateProviders([
    { id: 'provider_1', openaiCompatibleEndpoint: 'http://example.com/v1' }
]);
assert.strictEqual(invalidProviderEndpoint.ok, false);
assert.strictEqual(invalidProviderEndpoint.provider, 'provider_1');
assert.strictEqual(invalidProviderEndpoint.field, 'openaiCompatibleEndpoint');

assert.strictEqual(validateConfig({}).ok, true);
assert.strictEqual(validateConfig({ PROVIDERS: [] }).ok, true);
const invalidProvidersType = validateConfig({ PROVIDERS: {} });
assert.strictEqual(invalidProvidersType.ok, false);
assert.strictEqual(invalidProvidersType.reason, 'invalid');
assert.strictEqual(invalidProvidersType.field, 'PROVIDERS');
assert.strictEqual(
    validateConfig({ PROVIDERS: [{ openaiCompatibleEndpoint: 'http://example.com/v1' }] }).ok,
    false
);
assert.strictEqual(validateConfig({ AZURE_OPENAI_ENDPOINT: 'http://example.com' }).ok, false);
assert.strictEqual(
    validateConfig({ OPENAI_COMPATIBLE_ENDPOINT: 'http://localhost:11434/v1' }).ok,
    true
);

const contentScriptFiles = manifest.content_scripts[0].js;
assert.ok(
    contentScriptFiles.indexOf('endpoint-utils.js') > -1
    && contentScriptFiles.indexOf('endpoint-utils.js') < contentScriptFiles.indexOf('content.js'),
    'endpoint-utils.js must load before content.js'
);
assert.ok(
    settingsHtml.indexOf('endpoint-utils.js') > -1
    && settingsHtml.indexOf('endpoint-utils.js') < settingsHtml.indexOf('settings.js'),
    'endpoint-utils.js must load before settings.js'
);
assert.match(packageJson.scripts.package, /endpoint-utils\.js/);
for (const [name, content] of Object.entries({ releaseWorkflow, manualBuildWorkflow, testReleaseScript })) {
    assert.ok(content.includes('endpoint-utils.js'), `${name} must package endpoint-utils.js`);
}
assert.match(manualBuildWorkflow, /FILES=\([^)]*"endpoint-utils\.js"/);

assert.match(settingsScript, /function validateEndpointOrThrow\(endpoint\)/);
assert.match(settingsScript, /endpoint = validateEndpointOrThrow\(rawEndpoint\);/);
assert.match(settingsScript, /const azureEndpoint = validateEndpointOrThrow\(endpoint\)\.replace/);
assert.match(settingsScript, /const validatedEndpoint = validateEndpointOrThrow\(endpoint\);/);
assert.match(settingsScript, /endpoint = validateEndpointOrThrow\(modalOllamaEndpoint\.value\.trim\(\)/);
assert.match(settingsScript, /AskPageEndpoint\.validateConfig\(settings\)/);
assert.match(settingsScript, /importCustomEndpointWarning/);
assert.ok(
    settingsScript.includes(".replace(/\\/models$/, '').replace(/\\/v1\\/?$/, '')"),
    'Ollama fallback must strip /models before /v1'
);

assert.match(contentScript, /function getValidatedProviderEndpoint\(endpoint\)/);
assert.strictEqual(
    (contentScript.match(/const endpointValidation = getValidatedProviderEndpoint\(endpoint\);/g) || []).length,
    2,
    'both Azure and OpenAI-compatible request paths must validate the endpoint'
);
assert.match(
    contentScript,
    /endpoint = activeConfig\?\.openaiCompatibleEndpoint \|\| 'http:\/\/localhost:11434\/v1';/
);

console.log('endpoint-utils: ok');
