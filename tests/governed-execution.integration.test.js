'use strict';

const assert = require('assert');
const { buildToolPolicy } = require('../lib/tool-policy');
const {
    executeGovernedToolCall
} = require('../lib/tool-governance');

// 依治理層的 createBlockedResult 契約，把阻擋結果轉成既有工具結果格式。
function blockedResult({
    id,
    name,
    policy,
    plan,
    approval,
    precondition,
    error
}) {
    return {
        id,
        name,
        result: {
            success: false,
            data: {
                governance: {
                    risk: policy?.risk || 'unknown',
                    mode: plan?.mode || 'observe',
                    decision: plan?.decision || 'block',
                    approval,
                    precondition,
                    error
                }
            }
        }
    };
}

async function run() {
    let executions = 0;
    const audits = [];
    const execute = async (toolCall) => {
        executions += 1;
        return {
            id: toolCall.id,
            name: toolCall.name,
            result: {
                success: true,
                data: {
                    code: toolCall.args.code
                }
            }
        };
    };

    // ===== 拒絕核准：不得執行 =====
    const denied = await executeGovernedToolCall({
        toolCall: { id: 'deny', name: 'run_js', args: { code: 'return 1;' } },
        mode: 'enforce',
        buildPolicy: buildToolPolicy,
        requestApproval: async () => ({ approved: false }),
        validatePrecondition: async () => ({ valid: true }),
        execute,
        onAudit: (record) => audits.push(record),
        createBlockedResult: blockedResult
    });
    assert.strictEqual(denied.result.success, false);
    assert.strictEqual(denied.result.data.governance.approval, 'denied');
    assert.strictEqual(executions, 0, '未獲核准時不得執行工具');

    // ===== 核准後目標已改變（TOCTOU）：不得執行 =====
    const staleTarget = await executeGovernedToolCall({
        toolCall: { id: 'stale', name: 'run_js', args: { code: 'return 2;' } },
        mode: 'enforce',
        buildPolicy: buildToolPolicy,
        requestApproval: async () => ({ approved: true }),
        validatePrecondition: async () => ({ valid: false }),
        execute,
        onAudit: (record) => audits.push(record),
        createBlockedResult: blockedResult
    });
    assert.strictEqual(staleTarget.result.success, false);
    assert.strictEqual(staleTarget.result.data.governance.precondition, 'rejected');
    assert.strictEqual(executions, 0, '前置驗證失敗時不得執行工具');

    // ===== 核准流程失敗：必須 fail closed =====
    const approvalFailure = await executeGovernedToolCall({
        toolCall: { id: 'approval-error', name: 'run_js', args: { code: 'return 3;' } },
        mode: 'enforce',
        buildPolicy: buildToolPolicy,
        requestApproval: async () => {
            throw new Error('approval unavailable');
        },
        validatePrecondition: async () => ({ valid: true }),
        execute,
        onAudit: (record) => audits.push(record),
        createBlockedResult: blockedResult
    });
    assert.strictEqual(approvalFailure.result.success, false);
    assert.strictEqual(approvalFailure.result.data.governance.approval, 'error');
    assert.strictEqual(executions, 0, '核准流程失敗時必須 fail closed');

    // ===== 缺少核准機制：必須 fail closed =====
    const noApprovalHandler = await executeGovernedToolCall({
        toolCall: { id: 'no-handler', name: 'run_js', args: { code: 'return 3.5;' } },
        mode: 'enforce',
        buildPolicy: buildToolPolicy,
        execute,
        onAudit: (record) => audits.push(record),
        createBlockedResult: blockedResult
    });
    assert.strictEqual(noApprovalHandler.result.success, false);
    assert.strictEqual(noApprovalHandler.result.data.governance.approval, 'unavailable');
    assert.strictEqual(executions, 0, '缺少核准機制時必須 fail closed');

    // ===== 缺少前置驗證：即使核准也擋下 =====
    const noPrecondition = await executeGovernedToolCall({
        toolCall: { id: 'no-precondition', name: 'run_js', args: { code: 'return 3.7;' } },
        mode: 'enforce',
        buildPolicy: buildToolPolicy,
        requestApproval: async () => ({ approved: true }),
        execute,
        onAudit: (record) => audits.push(record),
        createBlockedResult: blockedResult
    });
    assert.strictEqual(noPrecondition.result.success, false);
    assert.strictEqual(noPrecondition.result.data.governance.precondition, 'unavailable');
    assert.strictEqual(executions, 0, '缺少前置驗證時不得執行工具');

    // ===== 核准後參數不可變 + 稽核失敗不影響執行 =====
    const original = { code: 'return 4;', nested: { value: 1 } };
    const executed = await executeGovernedToolCall({
        toolCall: { id: 'execute', name: 'run_js', args: original },
        mode: 'enforce',
        buildPolicy: buildToolPolicy,
        requestApproval: async ({ args }) => {
            assert.strictEqual(Object.isFrozen(args), true);
            assert.strictEqual(Object.isFrozen(args.nested), true);
            original.code = 'mutated after approval';
            original.nested.value = 99;
            return { approved: true };
        },
        validatePrecondition: async ({ args }) => {
            assert.strictEqual(args.code, 'return 4;');
            assert.strictEqual(args.nested.value, 1);
            return { valid: true };
        },
        execute,
        onAudit: async (record) => {
            audits.push(record);
            throw new Error('audit sink unavailable');
        },
        createBlockedResult: blockedResult
    });
    assert.strictEqual(executed.result.success, true);
    assert.strictEqual(executed.result.data.code, 'return 4;', '執行應使用核准當下的快照');
    assert.strictEqual(executions, 1);

    // ===== 等待核准期間的取消要往外拋 =====
    const cancellationError = Object.assign(new Error('cancelled'), {
        name: 'AbortError'
    });
    await assert.rejects(
        executeGovernedToolCall({
            toolCall: { id: 'cancel', name: 'run_js', args: { code: 'return 5;' } },
            mode: 'enforce',
            buildPolicy: buildToolPolicy,
            requestApproval: async () => {
                throw cancellationError;
            },
            validatePrecondition: async () => ({ valid: true }),
            execute,
            createBlockedResult: blockedResult,
            isCancellationError: (error) => error?.name === 'AbortError'
        }),
        (error) => error === cancellationError,
        '取消錯誤應原樣往外拋，不可被當成核准失敗'
    );
    assert.strictEqual(executions, 1);

    // ===== observe 模式不得改變既有行為 =====
    const observed = await executeGovernedToolCall({
        toolCall: { id: 'observe', name: 'run_js', args: { code: 'return 6;' } },
        mode: 'observe',
        buildPolicy: buildToolPolicy,
        execute,
        onAudit: (record) => audits.push(record),
        createBlockedResult: blockedResult
    });
    assert.strictEqual(observed.result.success, true);
    assert.strictEqual(executions, 2, 'observe 模式不需核准即可執行');

    // ===== 低風險工具在 enforce 模式直接放行 =====
    const readOnly = await executeGovernedToolCall({
        toolCall: { id: 'read-only', name: 'read_page', args: { mode: 'text' } },
        mode: 'enforce',
        buildPolicy: buildToolPolicy,
        execute,
        onAudit: (record) => audits.push(record),
        createBlockedResult: blockedResult
    });
    assert.strictEqual(readOnly.result.success, true);
    assert.strictEqual(executions, 3, '唯讀工具不應要求核准');

    // ===== 稽核紀錄 =====
    assert.ok(
        audits.some((record) => record.toolCallId === 'deny' && record.outcome === 'blocked'),
        '被擋下的呼叫應留下 blocked 紀錄'
    );
    assert.ok(
        audits.some((record) => record.toolCallId === 'execute' && record.outcome === 'executed'),
        '成功執行的呼叫應留下 executed 紀錄'
    );
    assert.ok(
        audits.some((record) => record.toolCallId === 'observe' && record.outcome === 'executed'),
        'observe 模式也應留下紀錄'
    );

    console.log('governed-execution.integration.test.js passed');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
