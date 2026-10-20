'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'lib/debug-logger.js'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, '..', 'lib/debug-console.js'), 'utf8');
let storageListener;
let enabled = false;
let downloaded;
let downloads = 0;
const listeners = {};
class DebugURL extends URL {
    static createObjectURL(blob) { downloaded = blob; return 'blob:test'; }
    static revokeObjectURL() {}
}
const sandbox = {
    URL: DebugURL, TextEncoder, TextDecoder, Blob, Error,
    location: { origin: 'https://example.com' },
    console: { info() {} },
    setTimeout: (callback) => callback(),
    Event: class Event { constructor(type) { this.type = type; } },
    window: {
        addEventListener: (type, listener) => { listeners[type] = listener; },
        dispatchEvent: (event) => { listeners[event.type]?.(event); }
    },
    document: {
        createElement: () => ({ click() { downloads++; } })
    },
    chrome: {
        runtime: { getManifest: () => ({ version: 'test' }) },
        storage: {
            local: { get: async () => ({ ASKPAGE_DEBUG_ENABLED: enabled }) },
            onChanged: { addListener: (listener) => { storageListener = listener; } }
        }
    }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
vm.runInContext(bridge, sandbox);
const api = sandbox.AskPageDebug;
const setEnabled = (value) => {
    enabled = value;
    storageListener({ ASKPAGE_DEBUG_ENABLED: { newValue: value } }, 'local');
};

(async () => {
    await api.ready;
    api.record('disabled', { message: 'must not be retained' });
    sandbox.window.askpageDebug.download();
    assert.strictEqual(api.exportData().events.length, 0);
    assert.strictEqual(downloads, 0);
    setEnabled(true);
    const credential = 'fake-private-credential/with+symbols';
    api.registerSecret(credential);
    api.record('redaction', {
        api_key: 'fake-key', Authorization: 'fake-auth', headers: { test: 'fake-header' },
        accessToken: 'fake-token', password: 'fake-password', screenshot: 'fake-image',
        message: `key=${credential} encoded=${encodeURIComponent(credential)} https://user:pass@example.com/path?key=fake-query#fake-fragment`,
        stack: 'Error: Authorization: Basic fake-basic\nCookie: a=fake-cookie; b=fake-cookie2'
    });
    api.recordTrace('test', { type: 'tool-call', round: 2, toolCalls: [{
        id: 'call-1', name: 'run_js', args: { code: 'const secret = "TOP_SECRET_CODE"; const r = await fetch(url); return r.json();', text: 'PRIVATE_PROMPT' }
    }] });
    api.recordTrace('test', { type: 'tool-result', round: 2, toolResults: [{
        id: 'call-1', name: 'run_js', durationMs: 33, result: {
            success: false, message: 'Unexpected end of JSON input',
            data: { errorName: 'SyntaxError', stack: 'SyntaxError: Unexpected end of JSON input', result: 'PRIVATE_PAGE_TEXT' }
        }
    }] });
    let exported = api.exportData();
    let json = JSON.stringify(exported);
    for (const secret of [credential, encodeURIComponent(credential), 'fake-key', 'fake-auth', 'fake-header', 'fake-token', 'fake-password', 'fake-image', 'fake-query', 'fake-fragment', 'user:pass', 'fake-basic', 'fake-cookie', 'TOP_SECRET_CODE', 'PRIVATE_PROMPT', 'PRIVATE_PAGE_TEXT']) {
        assert(!json.includes(secret), `Export leaked ${secret}`);
    }
    assert(json.includes('Unexpected end of JSON input'));
    assert(json.includes('.json('));
    assert(json.includes('durationMs'));
    // Credentials learned after an earlier event must also be scrubbed on export.
    api.record('late-secret', { message: 'late-private-key' });
    api.registerSecret('late-private-key');
    assert(!JSON.stringify(api.exportData()).includes('late-private-key'));
    sandbox.window.askpageDebug.download();
    assert.strictEqual(downloads, 1);
    assert.strictEqual(JSON.parse(await downloaded.text()).schemaVersion, 1);
    assert(!Object.hasOwn(sandbox.window.askpageDebug, 'exportData'), 'The page gets a signal-only helper');
    // Exercise the actual JSON and streaming transport hooks with credential-bearing requests.
    const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
    Object.assign(sandbox, {
        throwIfAskTaskCancelled() {}, isAskTaskCancellationError: () => false,
        isAskTaskCancelled: () => false, MAX_LLM_API_SERVICE_RETRIES: 0,
        analyzeProviderApiError: () => ({ shouldRetry: false }), logCopyableCurlCommand() {},
        readServerSentEvents: async () => {}
    });
    for (const [start, end] of [
        ['    async function fetchJsonWithRetry(', '    function createHttpError('],
        ['    async function fetchSseWithRetry(', '    function appendOpenAIChatToolCallDelta(']
    ]) {
        const first = content.indexOf(start);
        const last = content.indexOf(end, first);
        assert(first >= 0 && last > first);
        vm.runInContext(content.slice(first, last), sandbox);
    }
    const request = {
        providerLabel: 'test', url: 'https://example.com/api?key=fake-query', onEvent() {},
        options: { headers: { Authorization: 'Bearer fake-header-secret' }, body: 'PRIVATE_REQUEST_BODY' },
        fetchImpl: async () => new Response(''),
        buildHttpError: (response) => new Error(`HTTP ${response.status}`)
    };
    await assert.rejects(sandbox.fetchJsonWithRetry(request), /Unexpected end of JSON input/);
    await sandbox.fetchSseWithRetry({ ...request, fetchImpl: async () => new Response('data: test') });
    json = JSON.stringify(api.exportData());
    assert(json.includes('api-response'));
    assert(json.includes('api-error'));
    assert(json.includes('Unexpected end of JSON input'));
    assert(!json.includes('fake-header-secret'));
    assert(!json.includes('PRIVATE_REQUEST_BODY'));
    assert(!json.includes('fake-query'));
    const hostile = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('getter failed'); } });
    assert.doesNotThrow(() => api.record('hostile', hostile));
    api.record('function', { value: function privateFunction() { return 'PRIVATE_FUNCTION_SOURCE'; } });
    assert(!JSON.stringify(api.exportData()).includes('PRIVATE_FUNCTION_SOURCE'));
    assert.doesNotThrow(() => api.recordTrace('test', { type: 'tool-call', toolCalls: [{ args: hostile }] }));

    setEnabled(false);
    assert.strictEqual(api.exportData().events.length, 0);
    sandbox.window.askpageDebug.download();
    assert.strictEqual(downloads, 1);

    setEnabled(true);
    for (let index = 0; index < 650; index++) api.record('bounded', { index });
    exported = api.exportData();
    assert.strictEqual(exported.events.length, 500);
    assert(exported.limits.dropped > 0);
    assert.strictEqual(exported.events.at(-1).details.index, 649);
    assert(exported.events[0].sequence < exported.events.at(-1).sequence);
    for (let index = 0; index < 300; index++) api.record('bytes', { a: 'a'.repeat(2000), b: 'b'.repeat(2000), c: 'c'.repeat(2000) });
    exported = api.exportData();
    assert(Buffer.byteLength(JSON.stringify(exported.events)) <= 1024 * 1024);
    const cyclic = {}; cyclic.self = cyclic;
    assert.doesNotThrow(() => api.record('cyclic', cyclic));
    // Export objects must not give callers a mutable reference to retained entries.
    const first = api.exportData().events[0]; first.type = 'tampered';
    assert.notStrictEqual(api.exportData().events[0].type, 'tampered');
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    const collector = manifest.content_scripts.find((entry) => entry.js.includes('lib/debug-logger.js'));
    const consoleHelper = manifest.content_scripts.find((entry) => entry.js.includes('lib/debug-console.js'));
    assert.strictEqual(collector.world || 'ISOLATED', 'ISOLATED');
    assert(collector.js.indexOf('lib/debug-logger.js') < collector.js.indexOf('content.js'));
    assert.strictEqual(consoleHelper.world, 'MAIN');
    assert(!consoleHelper.js.includes('lib/debug-logger.js'));
    console.log('debug-logger: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
