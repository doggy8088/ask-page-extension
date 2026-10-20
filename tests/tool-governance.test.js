'use strict';

const assert = require('assert');
const {
    GOVERNANCE_MODE,
    EXECUTION_DECISION,
    normalizeGovernanceMode,
    snapshotToolArguments,
    planToolExecution,
    buildToolAuditRecord,
    shouldBlockWithoutApproval
} = require('../lib/tool-governance');

const safePolicy = { risk: 'read-only', requiresExplicitApproval: false };
const riskyPolicy = { risk: 'high-impact', requiresExplicitApproval: true };

// ===== 模式正規化：非 enforce 一律視為 observe =====
assert.strictEqual(normalizeGovernanceMode('anything'), GOVERNANCE_MODE.OBSERVE);
assert.strictEqual(normalizeGovernanceMode(undefined), GOVERNANCE_MODE.OBSERVE);
assert.strictEqual(normalizeGovernanceMode('enforce'), GOVERNANCE_MODE.ENFORCE);

// ===== 治理預檢 =====
assert.deepStrictEqual(
    planToolExecution(safePolicy, { mode: 'enforce' }),
    {
        mode: GOVERNANCE_MODE.ENFORCE,
        decision: EXECUTION_DECISION.ALLOW,
        requiresApproval: false,
        reason: 'policy-allows'
    },
    '低風險工具在 enforce 模式直接放行'
);

const observed = planToolExecution(riskyPolicy, { mode: 'observe' });
assert.strictEqual(observed.decision, EXECUTION_DECISION.ALLOW);
assert.strictEqual(observed.requiresApproval, true);
assert.strictEqual(observed.reason, 'observe-only');
assert.strictEqual(shouldBlockWithoutApproval(observed), false, 'observe 模式不擋下既有行為');

const enforced = planToolExecution(riskyPolicy, { mode: 'enforce' });
assert.strictEqual(enforced.decision, EXECUTION_DECISION.REQUIRE_APPROVAL);
assert.strictEqual(enforced.requiresApproval, true);
assert.strictEqual(shouldBlockWithoutApproval(enforced), true);

// 缺少政策時 enforce 必須擋下，不可放行。
const missing = planToolExecution(null, { mode: 'enforce' });
assert.strictEqual(missing.decision, EXECUTION_DECISION.BLOCK);
assert.strictEqual(missing.reason, 'missing-policy');
assert.strictEqual(shouldBlockWithoutApproval(missing), false, 'BLOCK 決策不走「缺少核准」路徑');

// observe 模式即使缺少政策也放行，維持既有行為。
const missingObserved = planToolExecution(null, { mode: 'observe' });
assert.strictEqual(missingObserved.decision, EXECUTION_DECISION.ALLOW);

// ===== 稽核紀錄 =====
const audit = buildToolAuditRecord({
    id: 'call-1',
    name: 'run_js',
    policy: riskyPolicy,
    plan: enforced,
    approval: 'approved',
    outcome: 'executed',
    success: true,
    durationMs: 12
});
assert.strictEqual(audit.version, 1);
assert.strictEqual(audit.toolCallId, 'call-1');
assert.strictEqual(audit.toolName, 'run_js');
assert.strictEqual(audit.risk, 'high-impact');
assert.strictEqual(audit.governanceMode, GOVERNANCE_MODE.ENFORCE);
assert.strictEqual(audit.decision, EXECUTION_DECISION.REQUIRE_APPROVAL);
assert.strictEqual(audit.approval, 'approved');
assert.strictEqual(audit.outcome, 'executed');
assert.strictEqual(audit.success, true);
assert.strictEqual(audit.durationMs, 12);
assert.ok(audit.timestamp, '稽核紀錄應帶時間戳');

// 錯誤訊息必須有長度上限，避免把整包錯誤塞進紀錄。
const boundedError = buildToolAuditRecord({ error: 'x'.repeat(2000) });
assert.ok(boundedError.error.length <= 500, '錯誤訊息應被截斷');

// ===== 參數快照 =====
{
    const original = { code: 'before', nested: { value: 1 } };
    const snapshot = snapshotToolArguments(original);
    original.code = 'after';
    original.nested.value = 2;
    assert.strictEqual(snapshot.code, 'before', '快照不可受原始物件影響');
    assert.strictEqual(snapshot.nested.value, 1);
    assert.strictEqual(Object.isFrozen(snapshot), true);
    assert.strictEqual(Object.isFrozen(snapshot.nested), true);
}

{
    const original = { fields: [{ value: 'a' }, { value: 'b' }] };
    const snapshot = snapshotToolArguments(original);
    original.fields[0].value = 'mutated';
    assert.strictEqual(snapshot.fields[0].value, 'a', '陣列內的物件也要被快照');
    assert.ok(Object.isFrozen(snapshot.fields), '快照陣列應被凍結');
    assert.ok(Object.isFrozen(snapshot.fields[0]), '快照內的元素應被凍結');
}

console.log('tool-governance.test.js passed');
