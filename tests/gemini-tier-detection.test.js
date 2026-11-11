'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const settingsSource = fs.readFileSync(path.join(rootDir, 'settings.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');
const zhTwCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, '_locales/zh_TW/messages.json'), 'utf8'));

function section(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert(first >= 0 && last > first, `Missing source section: ${start} .. ${end}`);
    return source.slice(first, last);
}

const plain = (value) => JSON.parse(JSON.stringify(value));

function createSharedStorage() {
    const store = {};
    return {
        store,
        api: {
            async get(keys) {
                if (!keys) {
                    return plain(store);
                }
                const list = Array.isArray(keys) ? keys : [keys];
                const out = {};
                list.forEach((key) => {
                    if (Object.prototype.hasOwnProperty.call(store, key)) {
                        out[key] = plain(store[key]);
                    }
                });
                return out;
            },
            async set(patch) {
                Object.entries(patch || {}).forEach(([key, value]) => {
                    store[key] = plain(value);
                });
            }
        }
    };
}

(async () => {
    const sharedStorage = createSharedStorage();
    const probeRequests = [];
    let probeResponder = async () => Response.json({ status: 'completed', steps: [] });

    const modalProviderType = { value: 'gemini' };
    const modalGeminiApiKey = { value: '' };
    const modalGeminiGoogleSearch = { checked: false };
    const modalGeminiGoogleSearchWarning = { hidden: true };

    const settingsSandbox = {
        console: { log() {}, warn() {}, error() {} },
        crypto: webcrypto,
        TextEncoder,
        TextDecoder,
        Response,
        setTimeout,
        clearTimeout,
        chrome: {
            storage: { local: sharedStorage.api }
        },
        document: {
            addEventListener() {}
        },
        fetch: async (url, options) => {
            probeRequests.push({
                url,
                headers: plain(options.headers),
                body: JSON.parse(options.body)
            });
            return probeResponder(url, options);
        }
    };
    settingsSandbox.globalThis = settingsSandbox;
    vm.createContext(settingsSandbox);
    vm.runInContext(settingsSource, settingsSandbox, { filename: 'settings.js' });
    vm.runInContext(
        `modalProviderType = __modalEls.modalProviderType;
modalGeminiApiKey = __modalEls.modalGeminiApiKey;
modalGeminiGoogleSearch = __modalEls.modalGeminiGoogleSearch;
modalGeminiGoogleSearchWarning = __modalEls.modalGeminiGoogleSearchWarning;
${section(settingsSource, '    let geminiWarningSyncSequence = 0;', '    // Provider modal listeners')}
globalThis.__settingsTierApi = {
    classifyGeminiTierProbeResponse,
    hashGeminiApiKey,
    getCachedGeminiApiKeyTier,
    setCachedGeminiApiKeyTier,
    probeGeminiApiKeyTier,
    syncGeminiGoogleSearchWarning,
    resetGeminiWarningSync
};`,
        Object.assign(settingsSandbox, {
            __modalEls: {
                modalProviderType,
                modalGeminiApiKey,
                modalGeminiGoogleSearch,
                modalGeminiGoogleSearchWarning
            }
        }),
        { filename: 'settings-warning-sync.js' }
    );

    const settingsApi = settingsSandbox.__settingsTierApi;

    // 1. Response classification distinguishes Free Tier vs Paid Tier vs transient/paid 429s.
    assert.strictEqual(settingsApi.classifyGeminiTierProbeResponse(200, '{"status":"completed"}'), 'paid');
    assert.strictEqual(
        settingsApi.classifyGeminiTierProbeResponse(
            429,
            'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0'
        ),
        'free'
    );
    assert.strictEqual(
        settingsApi.classifyGeminiTierProbeResponse(
            429,
            '{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}'
        ),
        'free'
    );
    assert.strictEqual(
        settingsApi.classifyGeminiTierProbeResponse(
            403,
            'Grounding with Google Search is not available on the Free tier.'
        ),
        'free'
    );
    assert.strictEqual(
        settingsApi.classifyGeminiTierProbeResponse(
            429,
            'Resource has been exhausted (e.g. check quota) for paid tier RPM.'
        ),
        'unknown'
    );
    assert.strictEqual(settingsApi.classifyGeminiTierProbeResponse(400, 'API key not valid'), 'unknown');
    assert.strictEqual(settingsApi.classifyGeminiTierProbeResponse(503, 'Service unavailable'), 'unknown');

    // 2. Paid Tier (Tier 1+) key: probes once, caches SHA-256 fingerprint (never raw key), keeps warning hidden.
    modalGeminiApiKey.value = 'AIzaSyPaidTierKey123';
    modalGeminiGoogleSearch.checked = true;
    probeResponder = async () => Response.json({ status: 'completed', steps: [] });
    await settingsApi.syncGeminiGoogleSearchWarning({ probeIfNeeded: true });

    assert.strictEqual(probeRequests.length, 1);
    assert.strictEqual(probeRequests[0].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.strictEqual(probeRequests[0].headers['x-goog-api-key'], 'AIzaSyPaidTierKey123');
    assert.deepStrictEqual(probeRequests[0].body, {
        model: 'gemini-3.5-flash-lite',
        store: false,
        input: 'OK',
        tools: [{ type: 'google_search' }],
        generation_config: {
            thinking_level: 'minimal',
            max_output_tokens: 1
        }
    });
    assert.strictEqual(modalGeminiGoogleSearchWarning.hidden, true, 'Tier 1+ key must not show free-tier warning');
    assert.strictEqual(await settingsApi.getCachedGeminiApiKeyTier('AIzaSyPaidTierKey123'), 'paid');
    assert.strictEqual(
        JSON.stringify(sharedStorage.store).includes('AIzaSyPaidTierKey123'),
        false,
        'Raw API key must never be stored in GEMINI_KEY_TIERS'
    );

    // Subsequent syncs hit cache without issuing another probe request.
    await settingsApi.syncGeminiGoogleSearchWarning({ probeIfNeeded: true });
    assert.strictEqual(probeRequests.length, 1);
    assert.strictEqual(modalGeminiGoogleSearchWarning.hidden, true);

    // 3. Free-tier key: shows warning when checked, hides when unchecked, and restores from cache.
    modalGeminiApiKey.value = 'AIzaSyFreeTierKey456';
    modalGeminiGoogleSearch.checked = true;
    probeResponder = async () => new Response(
        JSON.stringify({
            error: {
                code: 429,
                message: 'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0'
            }
        }),
        { status: 429 }
    );
    await settingsApi.syncGeminiGoogleSearchWarning({ probeIfNeeded: true });
    assert.strictEqual(probeRequests.length, 2);
    assert.strictEqual(modalGeminiGoogleSearchWarning.hidden, false, 'Free-tier key must show warning when checked');
    assert.strictEqual(await settingsApi.getCachedGeminiApiKeyTier('AIzaSyFreeTierKey456'), 'free');

    modalGeminiGoogleSearch.checked = false;
    await settingsApi.syncGeminiGoogleSearchWarning({ probeIfNeeded: false });
    assert.strictEqual(modalGeminiGoogleSearchWarning.hidden, true, 'Unchecking Google Search must hide warning');

    modalGeminiGoogleSearch.checked = true;
    await settingsApi.syncGeminiGoogleSearchWarning({ probeIfNeeded: true });
    assert.strictEqual(probeRequests.length, 2, 'Cached free-tier key should not re-probe on toggle');
    assert.strictEqual(modalGeminiGoogleSearchWarning.hidden, false);

    // 4. Force refresh (used by "Test Connection") updates cached 'free' to 'paid' after billing upgrade.
    probeResponder = async () => Response.json({ status: 'completed', steps: [] });
    const refreshedTier = await settingsApi.probeGeminiApiKeyTier('AIzaSyFreeTierKey456', { forceRefresh: true });
    assert.strictEqual(refreshedTier, 'paid');
    assert.strictEqual(probeRequests.length, 3);
    await settingsApi.syncGeminiGoogleSearchWarning({ probeIfNeeded: false });
    assert.strictEqual(modalGeminiGoogleSearchWarning.hidden, true, 'Upgraded key should hide free-tier warning');

    // 5. Transient paid-tier 429 (without free_tier marker) neither caches 'free' nor shows warning.
    modalGeminiApiKey.value = 'AIzaSyTransientRateLimitedKey789';
    modalGeminiGoogleSearch.checked = true;
    probeResponder = async () => new Response(
        JSON.stringify({ error: { code: 429, message: 'Too many requests per minute' } }),
        { status: 429 }
    );
    await settingsApi.syncGeminiGoogleSearchWarning({ probeIfNeeded: true });
    assert.strictEqual(modalGeminiGoogleSearchWarning.hidden, true, 'Paid-tier 429 must not show free-tier warning');
    assert.strictEqual(await settingsApi.getCachedGeminiApiKeyTier('AIzaSyTransientRateLimitedKey789'), 'unknown');

    // 6. Runtime content.js integration: syncs tier cache and appends warning ONLY on Free-tier 429 with Google Search.
    let workerResponses = [];
    let onWorkerConnect;
    const workerSandbox = {
        AbortController,
        TextDecoder,
        fetch: async () => {
            assert(workerResponses.length > 0, 'Unexpected worker fetch');
            return workerResponses.shift();
        },
        chrome: {
            runtime: {
                onConnect: {
                    addListener(listener) {
                        onWorkerConnect = listener;
                    }
                }
            }
        }
    };
    vm.createContext(workerSandbox);
    vm.runInContext(
        backgroundSource.slice(
            backgroundSource.indexOf('const LLM_API_FETCH_PORT'),
            backgroundSource.indexOf('// Add message listener for debugging')
        ),
        workerSandbox
    );

    const contentSandbox = {
        console: { log() {}, debug() {}, warn() {}, error() {} },
        crypto: webcrypto,
        TextDecoder,
        TextEncoder,
        ReadableStream,
        Response,
        Headers,
        URL,
        setTimeout,
        clearTimeout,
        chrome: {
            runtime: {
                getURL: (resource) => resource,
                onMessage: { addListener() {} },
                connect: ({ name }) => {
                    const listeners = [[], []];
                    const disconnectListeners = [];
                    let disconnected = false;
                    const makePort = (side) => ({
                        name,
                        onMessage: { addListener(listener) { listeners[side].push(listener); } },
                        onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
                        postMessage(message) {
                            if (disconnected) { throw new Error('Port disconnected'); }
                            queueMicrotask(() => listeners[1 - side].forEach((listener) => listener(plain(message))));
                        },
                        disconnect() {
                            if (disconnected) { return; }
                            disconnected = true;
                            disconnectListeners.forEach((listener) => listener());
                        }
                    });
                    onWorkerConnect(makePort(1));
                    return makePort(0);
                }
            },
            storage: { local: sharedStorage.api }
        },
        document: { readyState: 'complete' },
        window: { location: { href: 'about:blank' } },
        AskPageI18n: {
            t(key, substitutions = {}) {
                const message = zhTwCatalog[key]?.message || key;
                return message.replace(/\$([A-Za-z][A-Za-z0-9_]*)\$/g, (match, name) => {
                    const foundKey = Object.keys(substitutions).find((k) => k.toLowerCase() === name.toLowerCase());
                    const value = foundKey ? substitutions[foundKey] : undefined;
                    return value === undefined || value === null ? match : String(value);
                });
            }
        },
        logCopyableCurlCommand() {},
        logDiagnostic() {},
        getRetryAfterMilliseconds: () => null,
        formatToolDisplayName: (name) => name,
        formatToolNameList: (names) => names.join(', '),
        getToolDefinitions: () => []
    };
    contentSandbox.globalThis = contentSandbox;
    vm.createContext(contentSandbox);
    vm.runInContext(contentSource, contentSandbox, { filename: 'content.js' });
    contentSandbox.getPageConversationContext = async () => ({
        systemPrompt: 'System prompt',
        conversationContextText: 'Page snapshot',
        contextMode: 'snapshot'
    });
    vm.runInContext(
        `${section(contentSource, '    function parseApiErrorBody(', '    function getJsonPreview(')}
${section(contentSource, '    function buildModelToolResultPayload(', '    function escapeSelectorValue(')}
${section(contentSource, '    function getToolDefinitionsForRequest(', '    function parseToolArguments(')}
${section(contentSource, '    function getGeminiTextContent(', '    function isExpectedNonDisplayableTextError(')}
${section(contentSource, '    function parseSseJsonEvent(', '    function appendOpenAIChatToolCallDelta(')}
${section(contentSource, '    function mergeGeminiInteractionEvent(', '    async function runOpenAIStyleToolLoop(')}
${section(contentSource, '    async function runGeminiToolLoop(', '    async function askGemini(')}
globalThis.__contentTierApi = { runGeminiToolLoop };`,
        contentSandbox,
        { filename: 'content-runtime-tier.js' }
    );

    const warningMessage = zhTwCatalog.geminiGoogleSearchEnabledWarning.message;
    const { runGeminiToolLoop } = contentSandbox.__contentTierApi;

    // 6a. Free-tier 429 with Google Search enabled: no retries, caches 'free', appends warning.
    workerResponses = [
        new Response(
            JSON.stringify({
                error: {
                    code: 429,
                    message: 'You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0'
                }
            }),
            { status: 429, statusText: 'Too Many Requests' }
        )
    ];
    await assert.rejects(
        () => runGeminiToolLoop({
            apiKey: 'AIzaRuntimeFreeKey',
            selectedModel: 'gemini-3.8-flash',
            reasoningValue: 'medium',
            enableTools: false,
            googleSearchEnabled: true
        }),
        (err) => {
            assert.ok(err.userMessage.includes(warningMessage), 'Free-tier 429 with Google Search must include warning');
            return true;
        }
    );
    assert.strictEqual(
        await settingsApi.getCachedGeminiApiKeyTier('AIzaRuntimeFreeKey'),
        'free',
        'Runtime Free-tier 429 should sync free status to shared storage for settings UI'
    );

    // Confirm settings UI immediately shows warning for AIzaRuntimeFreeKey without extra probe.
    modalGeminiApiKey.value = 'AIzaRuntimeFreeKey';
    modalGeminiGoogleSearch.checked = true;
    const beforeSyncCount = probeRequests.length;
    await settingsApi.syncGeminiGoogleSearchWarning({ probeIfNeeded: true });
    assert.strictEqual(probeRequests.length, beforeSyncCount);
    assert.strictEqual(modalGeminiGoogleSearchWarning.hidden, false);

    // 6b. Paid-tier 429 (quota exceeded without free_tier marker) with Google Search enabled: must NOT include free-tier warning.
    workerResponses = [
        new Response(
            JSON.stringify({
                error: {
                    code: 429,
                    message: 'You exceeded your current quota for paid tier spend cap.'
                }
            }),
            { status: 429, statusText: 'Too Many Requests' }
        )
    ];
    await assert.rejects(
        () => runGeminiToolLoop({
            apiKey: 'AIzaRuntimePaidKey',
            selectedModel: 'gemini-4-carbon',
            reasoningValue: 'medium',
            enableTools: false,
            googleSearchEnabled: true
        }),
        (err) => {
            assert.strictEqual(
                err.userMessage.includes(warningMessage),
                false,
                'Paid-tier 429 must NEVER show the Free-tier warning'
            );
            return true;
        }
    );
    assert.strictEqual(await settingsApi.getCachedGeminiApiKeyTier('AIzaRuntimePaidKey'), 'unknown');

    // 6c. Successful Google Search turn at runtime caches 'paid' for shared settings UI.
    workerResponses = [
        Response.json({
            status: 'completed',
            steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Grounded answer' }] }],
            usage: { total_tokens: 12 }
        })
    ];
    contentSandbox.addConversationTurn('user', 'Hello');
    const result = await runGeminiToolLoop({
        apiKey: 'AIzaRuntimePaidKey',
        selectedModel: 'gemini-4-carbon',
        reasoningValue: 'medium',
        enableTools: false,
        googleSearchEnabled: true
    });
    assert.strictEqual(result.text, 'Grounded answer');
    assert.strictEqual(await settingsApi.getCachedGeminiApiKeyTier('AIzaRuntimePaidKey'), 'paid');

    console.log('gemini-tier-detection: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
