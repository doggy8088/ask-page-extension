'use strict';

// 這個測試守的是「content.js 與治理層的接線」，
// 避免有人改到工具執行流程卻沒注意到治理層被拔掉。

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const contentSource = fs.readFileSync(
    path.join(__dirname, '..', 'content.js'),
    'utf8'
);
const governanceSource = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'tool-governance.js'),
    'utf8'
);
const policySource = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'tool-policy.js'),
    'utf8'
);
const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8')
);

// ===== content.js 必須把執行交給治理層 =====
assert.ok(
    contentSource.includes('governance?.executeGovernedToolCall'),
    'content runtime 必須把工具執行交給共用治理層'
);
assert.ok(
    contentSource.includes('executeToolCallUngoverned'),
    '既有工具實作必須保留在治理層後方'
);

// ===== enforce 模式不可在治理模組缺失時放行 =====
assert.ok(
    contentSource.includes("toolContext.governanceMode === 'enforce'"),
    '治理模組不可用時，enforce 模式必須擋下'
);
assert.ok(
    contentSource.includes('governance-module-unavailable'),
    '必須說明治理模組不可用的原因'
);

// ===== 所有 provider 共用同一份風險標註定義 =====
assert.ok(
    contentSource.includes('functionDeclarations') === false,
    'Gemini 沿用 Interactions API 的 {type:"function"} 格式，不應出現 functionDeclarations'
);
assert.ok(
    contentSource.includes('getToolDefinitionsForRequest({'),
    'Gemini 頁面工具必須走共用的風險標註定義'
);
assert.ok(
    contentSource.includes('getToolDefinitions().map(annotateRisk)'),
    'OpenAI 風格工具定義必須套用風險標註'
);
assert.ok(
    contentSource.includes('annotateRisk(getWebSearchToolDefinition())'),
    'web_search 也必須套用風險標註'
);

// ===== 治理層的關鍵語意 =====
assert.ok(
    governanceSource.includes('snapshotToolArguments'),
    '治理層必須快照已核准的參數'
);
assert.ok(
    governanceSource.includes('validatePrecondition'),
    '治理層必須支援核准後的前置驗證'
);
assert.ok(
    governanceSource.includes('isCancellationError'),
    '治理層必須保留取消語意'
);
assert.ok(
    governanceSource.includes('Async tool audit callback failed'),
    '非同步稽核回呼失敗必須與執行隔離'
);
assert.ok(
    governanceSource.includes('EXECUTION_DECISION.REQUIRE_APPROVAL'),
    '治理層必須有明確的「需要核准」決策'
);

// ===== 政策層必須對未知工具採保守分類 =====
assert.ok(
    policySource.includes('TOOL_RISK.UNKNOWN'),
    '政策層必須保留 unknown 風險層級'
);
assert.ok(
    policySource.includes('|| TOOL_RISK.UNKNOWN'),
    '未知工具必須落到 unknown，不可默默視為安全'
);

// ===== 每個內建工具都必須被分類，新增工具時不可漏掉 =====
const toolDefinitionsSection = contentSource.slice(
    contentSource.indexOf('    function getToolDefinitions() {'),
    contentSource.indexOf('    function getToolDefinitionsForRequest(')
);
const builtInToolNames = Array.from(
    toolDefinitionsSection.matchAll(/name:\s*'([a-z_]+)'/g),
    (match) => match[1]
);
assert.ok(builtInToolNames.length > 0, '應能從 content.js 取得內建工具清單');

const policyMapSection = policySource.slice(
    policySource.indexOf('const TOOL_RISK_MAP'),
    policySource.indexOf('function classifyToolRisk')
);
const classifiedToolNames = Array.from(
    policyMapSection.matchAll(/([a-z_]+):\s*TOOL_RISK\./g),
    (match) => match[1]
);

builtInToolNames.forEach((toolName) => {
    assert.ok(
        classifiedToolNames.includes(toolName),
        `內建工具 ${toolName} 未列入風險對照表，需在 lib/tool-policy.js 補上分類`
    );
});

// ===== manifest 必須在 content.js 之前載入治理層 =====
const contentScriptFiles = manifest.content_scripts?.[0]?.js || [];
const policyIndex = contentScriptFiles.indexOf('lib/tool-policy.js');
const governanceIndex = contentScriptFiles.indexOf('lib/tool-governance.js');
const contentIndex = contentScriptFiles.indexOf('content.js');
assert.ok(policyIndex >= 0, 'manifest 必須載入 lib/tool-policy.js');
assert.ok(governanceIndex >= 0, 'manifest 必須載入 lib/tool-governance.js');
assert.ok(
    policyIndex < contentIndex && governanceIndex < contentIndex,
    '治理層必須在 content.js 之前載入'
);

console.log('governance-runtime-guard.test.js passed');
