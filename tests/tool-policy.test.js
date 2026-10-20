'use strict';

const assert = require('assert');
const {
    TOOL_RISK,
    coerceSubmitFlag,
    classifyToolRisk,
    classifyToolCallRisk,
    requiresExplicitApproval,
    buildToolPolicy
} = require('../lib/tool-policy');

// ===== 基礎風險分類 =====
assert.strictEqual(classifyToolRisk('read_page'), TOOL_RISK.READ_ONLY);
assert.strictEqual(classifyToolRisk('find'), TOOL_RISK.READ_ONLY);
assert.strictEqual(classifyToolRisk('get_page_text'), TOOL_RISK.READ_ONLY);
assert.strictEqual(classifyToolRisk('get_page_metadata'), TOOL_RISK.READ_ONLY);
assert.strictEqual(classifyToolRisk('inspect_selection'), TOOL_RISK.READ_ONLY);
assert.strictEqual(classifyToolRisk('inspect_form_fields'), TOOL_RISK.READ_ONLY);
assert.strictEqual(classifyToolRisk('web_search'), TOOL_RISK.READ_ONLY);
assert.strictEqual(classifyToolRisk('click'), TOOL_RISK.EXTERNAL_SIDE_EFFECT);
// type / select_option / fill_form_fields 會派發 input / change / blur 事件，
// checkbox 與 radio 更是呼叫原生 .click()，頁面若綁了自動送出就會產生外部副作用。
assert.strictEqual(classifyToolRisk('type'), TOOL_RISK.EXTERNAL_SIDE_EFFECT);
assert.strictEqual(classifyToolRisk('select_option'), TOOL_RISK.EXTERNAL_SIDE_EFFECT);
assert.strictEqual(classifyToolRisk('fill_form_fields'), TOOL_RISK.EXTERNAL_SIDE_EFFECT);
assert.strictEqual(classifyToolRisk('run_js'), TOOL_RISK.HIGH_IMPACT);

// 未知工具不能默默視為安全。
assert.strictEqual(classifyToolRisk('does-not-exist'), TOOL_RISK.UNKNOWN);
assert.strictEqual(classifyToolRisk(''), TOOL_RISK.UNKNOWN);
assert.strictEqual(classifyToolRisk(undefined), TOOL_RISK.UNKNOWN);

// 只能查詢對照表自己的屬性，繼承自 Object.prototype 的名稱必須視為未知。
assert.strictEqual(classifyToolRisk('constructor'), TOOL_RISK.UNKNOWN);
assert.strictEqual(classifyToolRisk('toString'), TOOL_RISK.UNKNOWN);
assert.strictEqual(classifyToolRisk('__proto__'), TOOL_RISK.UNKNOWN);
assert.strictEqual(classifyToolRisk('valueOf'), TOOL_RISK.UNKNOWN);
assert.strictEqual(classifyToolRisk('hasOwnProperty'), TOOL_RISK.UNKNOWN);

// ===== 依參數升級風險 =====
assert.strictEqual(
    classifyToolCallRisk('type', { submit: true }),
    TOOL_RISK.EXTERNAL_SIDE_EFFECT,
    '送出表單的輸入應升級為外部副作用'
);
assert.strictEqual(
    classifyToolCallRisk('fill_form_fields', { submit: true }),
    TOOL_RISK.EXTERNAL_SIDE_EFFECT
);

// 政策層的布林正規化必須與 content.js 的 coerceBooleanValue 一致，
// 否則 policy 與實際執行會對同一個參數給出不同結論，形成可繞過的缺口。
[
    true,
    'true',
    'yes',
    1,
    'on',
    'checked',
    'selected',
    '是',
    '需要',
    '勾選'
].forEach((value) => {
    assert.strictEqual(
        coerceSubmitFlag(value),
        true,
        `coerceSubmitFlag(${JSON.stringify(value)}) 應為 true`
    );
});

[
    false,
    'false',
    'no',
    0,
    'off',
    'unchecked',
    'unselected',
    '否',
    '不要',
    '取消',
    undefined,
    null,
    '',
    'garbage'
].forEach((value) => {
    assert.strictEqual(
        coerceSubmitFlag(value),
        false,
        `coerceSubmitFlag(${JSON.stringify(value)}) 應為 false`
    );
});

// 'true' 之類的字串同樣代表送出表單，不可因為型別不同就降級風險。
assert.strictEqual(
    classifyToolCallRisk('type', { submit: 'true' }),
    TOOL_RISK.EXTERNAL_SIDE_EFFECT,
    'submit 為字串 "true" 時仍應視為送出表單'
);
assert.strictEqual(
    classifyToolCallRisk('type', { submit: 'yes' }),
    TOOL_RISK.EXTERNAL_SIDE_EFFECT
);
assert.strictEqual(
    classifyToolCallRisk('type', { submit: 1 }),
    TOOL_RISK.EXTERNAL_SIDE_EFFECT
);
assert.strictEqual(
    classifyToolCallRisk('type', { submit: 'false' }),
    TOOL_RISK.EXTERNAL_SIDE_EFFECT,
    'type 本身即為 external-side-effect，submit 為 false 時仍需核准'
);

// ===== 是否需要明確核准 =====
assert.strictEqual(requiresExplicitApproval(TOOL_RISK.READ_ONLY), false);
assert.strictEqual(requiresExplicitApproval(TOOL_RISK.REVERSIBLE_MUTATION), false);
assert.strictEqual(requiresExplicitApproval(TOOL_RISK.EXTERNAL_SIDE_EFFECT), true);
assert.strictEqual(requiresExplicitApproval(TOOL_RISK.HIGH_IMPACT), true);
assert.strictEqual(requiresExplicitApproval(TOOL_RISK.UNKNOWN), true);

// ===== 政策組建 =====
assert.deepStrictEqual(buildToolPolicy('run_js'), {
    name: 'run_js',
    risk: TOOL_RISK.HIGH_IMPACT,
    requiresExplicitApproval: true
});
assert.deepStrictEqual(buildToolPolicy('read_page'), {
    name: 'read_page',
    risk: TOOL_RISK.READ_ONLY,
    requiresExplicitApproval: false
});
assert.deepStrictEqual(
    buildToolPolicy('type', { submit: true }),
    {
        name: 'type',
        risk: TOOL_RISK.EXTERNAL_SIDE_EFFECT,
        requiresExplicitApproval: true
    }
);

console.log('tool-policy.test.js passed');
