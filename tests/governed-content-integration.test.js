'use strict';

// 端到端驗證：治理層真的接在 content.js 的工具執行路徑上，
// 而且各 provider 拿到的工具定義一致、風險標註有送到模型。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const contentSource = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const policySource = fs.readFileSync(path.join(rootDir, 'lib', 'tool-policy.js'), 'utf8');
const governanceSource = fs.readFileSync(path.join(rootDir, 'lib', 'tool-governance.js'), 'utf8');

function section(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert(first >= 0 && last > first, `Missing source section: ${start}`);
    return source.slice(first, last);
}

const sandbox = {
    console: { log() {}, debug() {}, warn() {}, error() {} },
    chrome: {
        runtime: { getURL: (resource) => resource, onMessage: { addListener() {} } },
        storage: { local: { async get() { return {}; }, async set() {} } }
    },
    document: { readyState: 'complete' },
    window: { location: { href: 'about:blank' } },
    AskPageI18n: { t: (key) => key },
    fetch: async () => { throw new Error('blocked'); },
    analyzeProviderApiError: () => ({ shouldRetry: false, userMessage: 'err' }),
    getRetryAfterMilliseconds: () => null,
    formatToolDisplayName: (name) => name,
    formatToolNameList: (names) => names.join(', '),
    getToolDefinitions: () => [
        {
            name: 'read_page',
            description: '讀取頁面',
            parameters: { type: 'object', properties: { ref: { type: 'string' } } }
        },
        {
            name: 'run_js',
            description: '執行 JavaScript',
            parameters: { type: 'object', properties: { code: { type: 'string' } } }
        }
    ],
    // content.js 頂層函式，擷取片段時需一併提供。
    buildGeminiRequestTools: (additionalTools = [], includeGoogleSearch = true) => (
        includeGoogleSearch
            ? [{ type: 'google_search' }, ...additionalTools]
            : additionalTools
    ),
    doesGeminiModelSupportCombinedTools: () => true,
    createToolResult: (success, message, data = {}, warnings = [], matchedTargets = []) => ({
        success,
        message,
        data,
        warnings,
        matchedTargets
    }),
    throwIfAskTaskCancelled: () => {},
    isAskTaskCancellationError: (error) => error?.askPageTaskCancellation === true,
    awaitWithAskTaskCancellation: async (value) => await value,
    executeOllamaCloudWebSearch: async () => ({ success: true, message: 'stub' })
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// 依 manifest 順序載入治理層，再載入 content script。
vm.runInContext(policySource, sandbox, { filename: 'lib/tool-policy.js' });
vm.runInContext(governanceSource, sandbox, { filename: 'lib/tool-governance.js' });

// 這些函式巢狀在 createDialog 內，測試需自行擷取對應片段。
// 執行路徑從 executeToolCallUngoverned 到 getToolDefinitionsForRequest 為止。
vm.runInContext(
    `${section(contentSource, '    async function executeToolCallUngoverned(', '    function getToolDefinitionsForRequest(')}
${section(contentSource, '    function getToolDefinitionsForRequest(', '    function parseToolArguments(')}
globalThis.__exports = {
    getToolDefinitionsForRequest,
    getOpenAIToolDefinitions,
    getOpenAIResponsesToolDefinitions,
    getGeminiToolDefinitions,
    executeToolCall
};`,
    sandbox,
    { filename: 'content.js' }
);
const api = sandbox.__exports;

// ===== 各 provider 拿到的風險標註必須一致 =====
const requestTools = api.getToolDefinitionsForRequest({ includePageTools: true });
const openAiTools = api.getOpenAIToolDefinitions({ includePageTools: true });
const openAiResponsesTools = api.getOpenAIResponsesToolDefinitions({ includePageTools: true });
const geminiTools = api.getGeminiToolDefinitions('gemini-2.5-flash-lite', true, false);

const openAiDescriptions = openAiTools.map((tool) => tool.function.description);
const openAiResponsesDescriptions = openAiResponsesTools.map((tool) => tool.description);
const geminiDescriptions = geminiTools.map((tool) => tool.description);

assert.deepStrictEqual(
    openAiDescriptions,
    requestTools.map((tool) => tool.description),
    'OpenAI 風格工具定義應與共用來源一致'
);
assert.deepStrictEqual(
    openAiResponsesDescriptions,
    requestTools.map((tool) => tool.description),
    'OpenAI Responses 工具定義應與共用來源一致'
);
assert.deepStrictEqual(
    geminiDescriptions,
    requestTools.map((tool) => tool.description),
    'Gemini 工具定義應與共用來源一致'
);

// ===== 風險標註確實送進模型看得到的描述 =====
const readPageTool = requestTools.find((tool) => tool.name === 'read_page');
const runJsTool = requestTools.find((tool) => tool.name === 'run_js');
assert.ok(
    readPageTool.description.startsWith('[tool-risk: read-only]'),
    `唯讀工具應帶風險標註，實際：${readPageTool.description}`
);
assert.ok(
    runJsTool.description.startsWith('[tool-risk: high-impact]'),
    `高衝擊工具應帶風險標註，實際：${runJsTool.description}`
);
assert.ok(
    readPageTool.description.includes('讀取頁面'),
    '風險標註不應取代原本的工具描述'
);

// ===== Gemini 仍使用 Interactions API 的 {type:"function"} 格式 =====
assert.strictEqual(geminiTools[0].type, 'function');
assert.strictEqual(
    geminiTools[0].name,
    'read_page',
    'Gemini 工具宣告需保留 name/description/parameters'
);

// ===== observe 模式（預設）不得改變既有行為 =====
(async () => {
    const observed = await api.executeToolCall({
        id: 'observe-call',
        name: 'read_page',
        args: { ref: 'e1' }
    }, {
        // 治理層已載入，但 observe 模式不需要核准機制。
        governanceMode: 'observe'
    });
    assert.ok(observed, 'observe 模式應回傳工具結果');
    assert.strictEqual(
        observed.result?.data?.governance,
        undefined,
        'observe 模式的成功結果不應帶治理阻擋資訊'
    );

    // ===== enforce 模式但缺少核准機制：必須擋下 =====
    const blocked = await api.executeToolCall({
        id: 'enforce-call',
        name: 'run_js',
        args: { code: 'return 1;' }
    }, {
        governanceMode: 'enforce'
    });
    assert.strictEqual(blocked.result.success, false, 'enforce 模式缺少核准機制時必須擋下');
    assert.strictEqual(blocked.result.data.governance.approval, 'unavailable');
    assert.strictEqual(blocked.result.data.governance.risk, 'high-impact');

    // ===== enforce 模式 + 核准 + 前置驗證：應執行 =====
    const approved = await api.executeToolCall({
        id: 'approved-call',
        name: 'run_js',
        args: { code: 'return 1;' }
    }, {
        governanceMode: 'enforce',
        requestToolApproval: async () => ({ approved: true }),
        validateToolPrecondition: async () => ({ valid: true })
    });
    // run_js 在沙箱沒有 chrome.userScripts，會走既有錯誤處理，但流程不應被治理層擋下。
    assert.notStrictEqual(
        approved.result?.data?.governance?.approval,
        'unavailable',
        '核准且前置驗證通過後不應被治理層擋下'
    );

    console.log('governed-content-integration.test.js passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
