'use strict';

// 工具風險分類：只回答「這次呼叫有多危險」，不決定要不要擋。
// 執行層的決策交給 lib/tool-governance.js，兩者刻意分開，
// 讓分類規則可以單獨測試，也讓不同 provider 共用同一套判定。

const TOOL_RISK = Object.freeze({
    READ_ONLY: 'read-only',
    REVERSIBLE_MUTATION: 'reversible-mutation',
    EXTERNAL_SIDE_EFFECT: 'external-side-effect',
    HIGH_IMPACT: 'high-impact',
    UNKNOWN: 'unknown'
});

// 預設分類。未知工具一律落在 UNKNOWN，由治理層決定如何處理。
const TOOL_RISK_MAP = Object.freeze({
    web_search: TOOL_RISK.READ_ONLY,
    get_page_metadata: TOOL_RISK.READ_ONLY,
    inspect_selection: TOOL_RISK.READ_ONLY,
    inspect_form_fields: TOOL_RISK.READ_ONLY,
    read_page: TOOL_RISK.READ_ONLY,
    find: TOOL_RISK.READ_ONLY,
    get_page_text: TOOL_RISK.READ_ONLY,
    click: TOOL_RISK.EXTERNAL_SIDE_EFFECT,
    type: TOOL_RISK.REVERSIBLE_MUTATION,
    select_option: TOOL_RISK.REVERSIBLE_MUTATION,
    fill_form_fields: TOOL_RISK.REVERSIBLE_MUTATION,
    run_js: TOOL_RISK.HIGH_IMPACT
});

function classifyToolRisk(name) {
    return TOOL_RISK_MAP[name] || TOOL_RISK.UNKNOWN;
}

// 有些工具的風險取決於參數：送出表單比單純打字更有外部副作用。
function classifyToolCallRisk(name, args = {}) {
    const baseRisk = classifyToolRisk(name);
    if ((name === 'type' || name === 'fill_form_fields') && args && args.submit === true) {
        return TOOL_RISK.EXTERNAL_SIDE_EFFECT;
    }
    return baseRisk;
}

// 需要明確核准的風險層級。UNKNOWN 也納入，避免新增工具時預設放行。
function requiresExplicitApproval(risk) {
    return (
        risk === TOOL_RISK.EXTERNAL_SIDE_EFFECT ||
        risk === TOOL_RISK.HIGH_IMPACT ||
        risk === TOOL_RISK.UNKNOWN
    );
}

function buildToolPolicy(name, args = {}) {
    const risk = classifyToolCallRisk(name, args);
    return {
        name,
        risk,
        requiresExplicitApproval: requiresExplicitApproval(risk)
    };
}

const AskPageToolPolicy = Object.freeze({
    TOOL_RISK,
    TOOL_RISK_MAP,
    classifyToolRisk,
    classifyToolCallRisk,
    requiresExplicitApproval,
    buildToolPolicy
});

if (typeof globalThis !== 'undefined') {
    globalThis.AskPageToolPolicy = AskPageToolPolicy;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AskPageToolPolicy;
}
