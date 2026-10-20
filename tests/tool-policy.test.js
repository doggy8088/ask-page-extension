'use strict';

const assert = require('assert');
const {
    TOOL_RISK,
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
assert.strictEqual(classifyToolRisk('fill_form_fields'), TOOL_RISK.REVERSIBLE_MUTATION);
assert.strictEqual(classifyToolRisk('type'), TOOL_RISK.REVERSIBLE_MUTATION);
assert.strictEqual(classifyToolRisk('select_option'), TOOL_RISK.REVERSIBLE_MUTATION);
assert.strictEqual(classifyToolRisk('click'), TOOL_RISK.EXTERNAL_SIDE_EFFECT);
assert.strictEqual(classifyToolRisk('run_js'), TOOL_RISK.HIGH_IMPACT);

// 未知工具不能默默視為安全。
assert.strictEqual(classifyToolRisk('does-not-exist'), TOOL_RISK.UNKNOWN);
assert.strictEqual(classifyToolRisk(''), TOOL_RISK.UNKNOWN);
assert.strictEqual(classifyToolRisk(undefined), TOOL_RISK.UNKNOWN);

// ===== 依參數升級風險 =====
assert.strictEqual(
    classifyToolCallRisk('type', { submit: true }),
    TOOL_RISK.EXTERNAL_SIDE_EFFECT,
    '送出表單的輸入應升級為外部副作用'
);
assert.strictEqual(
    classifyToolCallRisk('type', { submit: false }),
    TOOL_RISK.REVERSIBLE_MUTATION,
    '未送出表單的輸入維持可逆修改'
);
assert.strictEqual(
    classifyToolCallRisk('type', {}),
    TOOL_RISK.REVERSIBLE_MUTATION
);
assert.strictEqual(
    classifyToolCallRisk('type', { submit: 'true' }),
    TOOL_RISK.REVERSIBLE_MUTATION,
    'submit 必須是真正的 true 才升級'
);
assert.strictEqual(
    classifyToolCallRisk('fill_form_fields', { submit: true }),
    TOOL_RISK.EXTERNAL_SIDE_EFFECT
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
