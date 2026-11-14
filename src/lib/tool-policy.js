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
    // 點擊會觸發頁面自身的 click 處理器，可能送出表單或導向外部資源。
    click: TOOL_RISK.EXTERNAL_SIDE_EFFECT,
    // type / select_option / fill_form_fields 雖然只是填值，但實作會派發
    // input / change / blur 事件，checkbox 與 radio 更是呼叫原生 .click()。
    // 頁面若綁了自動送出或 onchange 導向，這些呼叫就會產生外部副作用，
    // 因此一律視為 external-side-effect。
    type: TOOL_RISK.EXTERNAL_SIDE_EFFECT,
    select_option: TOOL_RISK.EXTERNAL_SIDE_EFFECT,
    fill_form_fields: TOOL_RISK.EXTERNAL_SIDE_EFFECT,
    run_js: TOOL_RISK.HIGH_IMPACT
});

// 與 content.js 的 coerceBooleanValue 保持一致，避免政策與實際執行對同一個
// 參數給出不同結論。任一處放寬都會讓 enforce 模式出現可繞過的缺口。
const TRUTHY_COERCION_VALUES = Object.freeze([
    'true', '1', 'yes', 'on', 'checked', 'selected', '是', '需要', '勾選'
]);

function normalizeCoercionText(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[！!？?，,。:：;；"'`~~@#$%^&*()_\-+=<>[\]{}|\\/]/g, '')
        .trim();
}

// 與 content.js 的 coerceBooleanValue(value, false) 等價。
function coerceSubmitFlag(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === null || value === undefined || value === '') {
        return false;
    }
    const normalized = normalizeCoercionText(value);
    if (!normalized) {
        return false;
    }
    return TRUTHY_COERCION_VALUES.includes(normalized);
}

// 只認取對照表自己的屬性，避免 constructor / toString / __proto__ 這類
// 繼承自 Object.prototype 的名稱被誤判成已知工具而跳過核准。
function classifyToolRisk(name) {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(TOOL_RISK_MAP, name)) {
        return TOOL_RISK.UNKNOWN;
    }
    return TOOL_RISK_MAP[name];
}

// 有些工具的風險取決於參數：送出表單比單純打字更有外部副作用。
function classifyToolCallRisk(name, args = {}) {
    const baseRisk = classifyToolRisk(name);
    if ((name === 'type' || name === 'fill_form_fields') && args && coerceSubmitFlag(args.submit)) {
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
    coerceSubmitFlag,
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
