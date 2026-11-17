'use strict';

// Agent Skills 在內容腳本端的行為：系統提示目錄、load_skill 工具、runtime 快取與失效、
// 詢問模式的工具邊界。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const contentSource = read('src/content.js');
const AskPageToolPolicy = require(path.join(rootDir, 'src', 'lib', 'tool-policy.js'));

function section(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert(first >= 0 && last > first, `Missing source section: ${start}`);
    return source.slice(first, last);
}

// vm context 與測試程序是不同 realm，以 JSON 轉成本 realm 的物件再比對。
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

let storageData = {};
const storageSetCalls = [];
const storageListeners = [];

const sandbox = {
    console: { log() {}, debug() {}, warn() {}, error() {}, info() {} },
    chrome: {
        runtime: { getURL: (resource) => resource, onMessage: { addListener() {} }, sendMessage() {} },
        storage: {
            local: {
                async get(keys) {
                    const list = Array.isArray(keys) ? keys : [keys];
                    return Object.fromEntries(list.filter((key) => key in storageData).map((key) => [key, storageData[key]]));
                },
                async set(values) {
                    storageSetCalls.push(values);
                }
            },
            onChanged: { addListener(listener) { storageListeners.push(listener); } }
        }
    },
    document: { addEventListener() {} },
    window: { location: { href: 'about:blank' } },
    // 以下為 createDialog 內部函式，擷取片段時需自行提供。
    createToolResult: (success, message, data = {}, warnings = [], matchedTargets = []) => ({
        success, message, data, warnings, matchedTargets
    }),
    getToolDefinitions: () => [
        { name: 'read_page', description: '讀取頁面', parameters: { type: 'object', properties: {} } },
        { name: 'run_js', description: '執行 JavaScript', parameters: { type: 'object', properties: {} } }
    ],
    getWebSearchToolDefinition: () => ({ name: 'web_search', description: '搜尋', parameters: { type: 'object', properties: {} } }),
    executeOllamaCloudWebSearch: async () => ({ success: true, message: 'stub' })
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('src/lib/tool-policy.js'), sandbox, { filename: 'lib/tool-policy.js' });
vm.runInContext(read('src/lib/tool-governance.js'), sandbox, { filename: 'lib/tool-governance.js' });
vm.runInContext(read('src/lib/skill-schema.js'), sandbox, { filename: 'lib/skill-schema.js' });
vm.runInContext(`${contentSource}
globalThis.__runtime = {
    buildSystemPrompt,
    buildLoadSkillResult,
    ensureSkillsRuntime,
    hasAutoSkills,
    getRuntimeSkills,
    isSummarySkillEnabled
};`, sandbox, { filename: 'content.js' });
vm.runInContext(`${section(contentSource, '    async function executeToolCallUngoverned(', '    function getToolDefinitionsForRequest(')}
${section(contentSource, '    function getToolDefinitionsForRequest(', '    function parseToolArguments(')}
globalThis.__tools = { executeToolCall, getToolDefinitionsForRequest, getGeminiToolDefinitions, getOpenAIToolDefinitions };`,
sandbox, { filename: 'content.js#tools' });

const runtime = sandbox.__runtime;
const tools = sandbox.__tools;
const Skills = sandbox.AskPageSkills;

const skillRecords = [
    {
        name: 'translate-to-english',
        command: '/翻譯',
        description: 'Translate text into natural English. Use when the user asks for an English translation.',
        instructions: 'Translate into English:\n\n${SELECTED_TEXT}\n\nTone: ${tone:formal}',
        invocation: 'auto'
    },
    {
        name: 'fill-report',
        command: '/report',
        description: 'Fill the weekly report form.',
        instructions: 'Fill the form for ${project}.',
        invocation: 'auto',
        askpage: { mode: 'agent' }
    },
    {
        name: 'optional-selection',
        command: '/optional',
        description: 'Uses selection when present.',
        instructions: 'Context: ${SELECTED_TEXT:none}',
        invocation: 'auto'
    },
    {
        name: 'secret-explicit',
        command: '/secret',
        description: 'Explicit only skill.',
        instructions: 'TOP SECRET BODY',
        invocation: 'explicit'
    },
    {
        name: 'paused-auto',
        command: '/paused',
        description: 'Disabled auto skill.',
        instructions: 'PAUSED BODY',
        invocation: 'auto',
        enabled: false
    }
];
const skills = Skills.normalizeSkills(skillRecords);
const autoSkills = Skills.getAutoSkills(skills);

// ---------- 系統提示 ----------
{
    const baseline = runtime.buildSystemPrompt({ pageContextFormat: 'semantic-tree' });
    assert.strictEqual(
        runtime.buildSystemPrompt({ pageContextFormat: 'semantic-tree', autoSkills: [], skillToolsEnabled: false }),
        baseline,
        '沒有自動技能時系統提示與原本相同'
    );
    assert.ok(!baseline.includes('load_skill'));
    assert.ok(!baseline.includes('Available skills'));

    const inquiry = runtime.buildSystemPrompt({ pageContextFormat: 'semantic-tree', autoSkills, skillToolsEnabled: true });
    assert.match(inquiry, /Do not use page tools in this mode\. Skill tools \(load_skill\) are allowed in this mode; page tools remain unavailable\./);
    assert.match(inquiry, /Available skills — translate-to-english: Translate text/);
    assert.match(inquiry, /fill-report: Fill the weekly report form\./);
    assert.ok(!inquiry.includes('secret-explicit'), '明確技能不進目錄');
    assert.ok(!inquiry.includes('paused-auto'), '停用技能不進目錄');
    assert.ok(!inquiry.includes('TOP SECRET BODY'));
    assert.ok(
        inquiry.indexOf('You are in inquiry mode') < inquiry.indexOf('Available skills'),
        '目錄放在模式說明之後'
    );

    const agent = runtime.buildSystemPrompt({ pageContextFormat: 'agent-snapshot', autoSkills, skillToolsEnabled: true });
    assert.match(agent, /You are in agent mode/);
    assert.match(agent, /Available skills — translate-to-english/);
    assert.ok(!agent.includes('Skill tools (load_skill) are allowed in this mode'), '代理模式不需要詢問模式的例外句');
}

// ---------- load_skill 結果 ----------
{
    const loaded = plain(runtime.buildLoadSkillResult({ name: 'translate-to-english' }, skills, { selectedText: 'Hello 世界' }));
    assert.strictEqual(loaded.success, true);
    assert.strictEqual(loaded.data.name, 'translate-to-english');
    assert.ok(loaded.data.instructions.includes('Hello 世界'), '解析 ${SELECTED_TEXT}');
    assert.ok(loaded.data.instructions.includes('${tone:formal}'), '使用者變數保留原文');
    assert.deepStrictEqual(loaded.data.unfilledVariables, [{ name: 'tone', defaultValue: 'formal' }]);
    assert.match(loaded.message, /未填變數（tone）/);
    assert.deepStrictEqual(loaded.warnings, []);

    const caseInsensitive = runtime.buildLoadSkillResult({ name: '  Translate-To-English ' }, skills, { selectedText: 'x' });
    assert.strictEqual(caseInsensitive.success, true);

    const missingSelection = plain(runtime.buildLoadSkillResult({ name: 'translate-to-english' }, skills, { selectedText: '' }));
    assert.strictEqual(missingSelection.success, false);
    assert.deepStrictEqual(missingSelection.data.missingVariables, ['SELECTED_TEXT']);

    const fallbackSelection = plain(runtime.buildLoadSkillResult({ name: 'optional-selection' }, skills, {}));
    assert.strictEqual(fallbackSelection.success, true);
    assert.strictEqual(fallbackSelection.data.instructions, 'Context: none');

    const explicit = plain(runtime.buildLoadSkillResult({ name: 'secret-explicit' }, skills, {}));
    assert.strictEqual(explicit.success, false, '拒絕明確技能');
    assert.ok(!JSON.stringify(explicit).includes('TOP SECRET BODY'), '不洩漏明確技能本文');

    const paused = plain(runtime.buildLoadSkillResult({ name: 'paused-auto' }, skills, {}));
    assert.strictEqual(paused.success, false, '拒絕停用技能');
    assert.ok(!JSON.stringify(paused).includes('PAUSED BODY'));

    assert.strictEqual(runtime.buildLoadSkillResult({ name: 'nope' }, skills, {}).success, false, '拒絕未知技能');
    assert.strictEqual(runtime.buildLoadSkillResult({ name: '/翻譯' }, skills, {}).success, false, '觸發名稱不能當 name');
    assert.strictEqual(runtime.buildLoadSkillResult({}, skills, {}).success, false);

    const agentSkillInInquiry = plain(runtime.buildLoadSkillResult({ name: 'fill-report' }, skills, { agentModeEnabled: false }));
    assert.strictEqual(agentSkillInInquiry.success, true);
    assert.strictEqual(agentSkillInInquiry.warnings.length, 1);
    assert.match(agentSkillInInquiry.warnings[0], /代理模式/);
    assert.deepStrictEqual(
        plain(runtime.buildLoadSkillResult({ name: 'fill-report' }, skills, { agentModeEnabled: true })).warnings,
        []
    );
}

// ---------- 工具定義與治理分類 ----------
assert.strictEqual(AskPageToolPolicy.TOOL_RISK_MAP.load_skill, 'read-only');
assert.strictEqual(AskPageToolPolicy.buildToolPolicy('load_skill').requiresExplicitApproval, false);
{
    const definition = Skills.buildLoadSkillToolDefinition();
    assert.strictEqual(definition.name, 'load_skill');
    assert.match(definition.parameters.properties.name.description, /not pass a slash trigger/);
}

(async () => {
    // ---------- runtime：讀取、記憶體遷移、失效 ----------
    storageData = { ASKPAGE_SKILLS: skillRecords };
    await runtime.ensureSkillsRuntime({ force: true });
    assert.strictEqual(runtime.hasAutoSkills(), true);
    assert.strictEqual(runtime.getRuntimeSkills().length, 5, 'runtime 保留停用技能供 /名稱 判斷');
    assert.strictEqual(runtime.isSummarySkillEnabled(), true, '/summary 預設啟用');

    // 沒有自動技能時：不送 load_skill
    storageData = { ASKPAGE_SKILLS: [skillRecords[3]], CUSTOM_SUMMARY_ENABLED: false };
    storageListeners.forEach((listener) => listener({ CUSTOM_SUMMARY_ENABLED: { newValue: false } }, 'local'));
    await runtime.ensureSkillsRuntime();
    assert.strictEqual(runtime.hasAutoSkills(), false, 'storage 變更後重新載入');
    assert.strictEqual(runtime.isSummarySkillEnabled(), false);
    assert.deepStrictEqual(plain(tools.getToolDefinitionsForRequest({ includePageTools: false, includeSkillTools: true })), []);

    // 舊資料：只在記憶體遷移，不寫回 storage
    storageData = { CUSTOM_COMMANDS: [{ cmd: '/舊技能', prompt: 'Legacy prompt' }] };
    storageListeners.forEach((listener) => listener({ ASKPAGE_SKILLS: { newValue: undefined } }, 'local'));
    await runtime.ensureSkillsRuntime();
    assert.strictEqual(runtime.getRuntimeSkills()[0].command, '/舊技能');
    assert.strictEqual(runtime.getRuntimeSkills()[0].invocation, 'explicit');
    assert.strictEqual(runtime.hasAutoSkills(), false);
    assert.strictEqual(storageSetCalls.length, 0, '內容腳本不寫入技能');

    // 無關的 storage 變更不會讓快取失效
    storageData = { ASKPAGE_SKILLS: skillRecords };
    storageListeners.forEach((listener) => listener({ SOMETHING_ELSE: { newValue: 1 } }, 'local'));
    await runtime.ensureSkillsRuntime();
    assert.strictEqual(runtime.hasAutoSkills(), false, '無關 key 不失效');
    storageListeners.forEach((listener) => listener({ ASKPAGE_SKILLS: { newValue: skillRecords } }, 'local'));
    await runtime.ensureSkillsRuntime();
    assert.strictEqual(runtime.hasAutoSkills(), true);

    // ---------- 工具清單：詢問模式只有 load_skill ----------
    const inquiryTools = plain(tools.getToolDefinitionsForRequest({ includePageTools: false, includeSkillTools: true }));
    assert.deepStrictEqual(inquiryTools.map((tool) => tool.name), ['load_skill']);
    assert.ok(inquiryTools[0].description.startsWith('[tool-risk: read-only]'));
    assert.deepStrictEqual(
        plain(tools.getToolDefinitionsForRequest({ includePageTools: true, includeSkillTools: true })).map((tool) => tool.name),
        ['read_page', 'run_js', 'load_skill']
    );
    assert.deepStrictEqual(
        plain(tools.getToolDefinitionsForRequest({ includePageTools: true })).map((tool) => tool.name),
        ['read_page', 'run_js'],
        '未要求技能工具時維持原狀'
    );
    assert.deepStrictEqual(
        plain(tools.getOpenAIToolDefinitions({ includePageTools: false, includeSkillTools: true })).map((tool) => tool.function.name),
        ['load_skill']
    );
    assert.deepStrictEqual(
        plain(tools.getGeminiToolDefinitions('gemini-2.5-flash-lite', false, false, true)).map((tool) => tool.name),
        ['load_skill']
    );
    assert.deepStrictEqual(
        plain(tools.getGeminiToolDefinitions('gemini-2.5-flash-lite', false, true, false)).map((tool) => tool.type),
        ['google_search'],
        '只有 google_search 時維持原狀'
    );

    // ---------- 執行：詢問模式拒絕頁面工具，允許 load_skill ----------
    const blocked = plain(await tools.executeToolCall({ id: '1', name: 'run_js', args: { code: '1' } }, { agentModeEnabled: false }));
    assert.strictEqual(blocked.result.success, false);
    assert.match(blocked.result.message, /詢問模式不提供工具 run_js/);

    const loadedViaTool = plain(await tools.executeToolCall(
        { id: '2', name: 'load_skill', args: { name: 'translate-to-english' } },
        { agentModeEnabled: false, selectedText: '選取內容' }
    ));
    assert.strictEqual(loadedViaTool.result.success, true);
    assert.ok(loadedViaTool.result.data.instructions.includes('選取內容'));

    const explicitViaTool = plain(await tools.executeToolCall(
        { id: '3', name: 'load_skill', args: { name: 'secret-explicit' } },
        { agentModeEnabled: true }
    ));
    assert.strictEqual(explicitViaTool.result.success, false);

    console.log('skill-runtime: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
