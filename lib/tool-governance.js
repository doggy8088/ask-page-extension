'use strict';

// 治理層：把「工具怎麼執行」與「這次呼叫能不能執行」分開。
//
// 執行流程：
//   工具請求 -> 風險分類 -> 治理預檢 ->（必要時）明確核准
//   -> 核准後重新驗證 target/precondition -> 執行既有工具 -> 稽核紀錄
//
// 兩種模式：
//   observe（預設）：只分類、只稽核，不擋任何現有行為。
//   enforce：需要核准的呼叫必須走完核准與前置驗證，否則一律擋下。

const GOVERNANCE_MODE = Object.freeze({
    OBSERVE: 'observe',
    ENFORCE: 'enforce'
});

const EXECUTION_DECISION = Object.freeze({
    ALLOW: 'allow',
    REQUIRE_APPROVAL: 'require-approval',
    BLOCK: 'block'
});

function normalizeGovernanceMode(mode) {
    return mode === GOVERNANCE_MODE.ENFORCE
        ? GOVERNANCE_MODE.ENFORCE
        : GOVERNANCE_MODE.OBSERVE;
}

// 深層複製並凍結，避免核准後呼叫端再改動參數內容。
function snapshotToolArguments(value) {
    if (Array.isArray(value)) {
        return Object.freeze(value.map(snapshotToolArguments));
    }
    if (value && typeof value === 'object') {
        const copy = {};
        for (const [key, item] of Object.entries(value)) {
            copy[key] = snapshotToolArguments(item);
        }
        return Object.freeze(copy);
    }
    return value;
}

// 治理預檢：只根據政策與模式決定這次呼叫怎麼走。
function planToolExecution(policy, options = {}) {
    const mode = normalizeGovernanceMode(options.mode);
    const requiresApproval = policy?.requiresExplicitApproval === true;

    // 沒有政策就是無法判斷風險。enforce 模式必須擋下，不可放行。
    if (!policy) {
        return {
            mode,
            decision: mode === GOVERNANCE_MODE.ENFORCE
                ? EXECUTION_DECISION.BLOCK
                : EXECUTION_DECISION.ALLOW,
            requiresApproval: mode === GOVERNANCE_MODE.ENFORCE,
            reason: 'missing-policy'
        };
    }

    if (!requiresApproval) {
        return {
            mode,
            decision: EXECUTION_DECISION.ALLOW,
            requiresApproval: false,
            reason: 'policy-allows'
        };
    }

    // observe 模式只標記風險，不擋下既有行為。
    if (mode === GOVERNANCE_MODE.OBSERVE) {
        return {
            mode,
            decision: EXECUTION_DECISION.ALLOW,
            requiresApproval: true,
            reason: 'observe-only'
        };
    }

    return {
        mode,
        decision: EXECUTION_DECISION.REQUIRE_APPROVAL,
        requiresApproval: true,
        reason: 'explicit-approval-required'
    };
}

function buildToolAuditRecord({
    id = '',
    name = '',
    policy = null,
    plan = null,
    approval = 'not-requested',
    outcome = 'unknown',
    success = null,
    durationMs = null,
    error = null
} = {}) {
    return {
        version: 1,
        timestamp: new Date().toISOString(),
        toolCallId: id,
        toolName: name,
        risk: policy?.risk || 'unknown',
        governanceMode: plan?.mode || GOVERNANCE_MODE.OBSERVE,
        decision: plan?.decision || EXECUTION_DECISION.ALLOW,
        approval,
        outcome,
        success,
        durationMs,
        error: error ? String(error).slice(0, 500) : null
    };
}

function shouldBlockWithoutApproval(plan) {
    return (
        plan?.mode === GOVERNANCE_MODE.ENFORCE &&
        plan?.decision === EXECUTION_DECISION.REQUIRE_APPROVAL
    );
}

async function executeGovernedToolCall({
    toolCall = {},
    mode = GOVERNANCE_MODE.OBSERVE,
    buildPolicy,
    requestApproval,
    validatePrecondition,
    execute,
    onAudit,
    createBlockedResult,
    awaitWithCancellation = async (value) => await value,
    signal = null,
    isCancellationError = () => false
} = {}) {
    const { id = '', name = '', args = {} } = toolCall || {};
    const toolArgs = args && typeof args === 'object' ? args : {};
    const requestedMode = normalizeGovernanceMode(mode);
    const approvedArgs = snapshotToolArguments(toolArgs);
    const policy = typeof buildPolicy === 'function'
        ? buildPolicy(name, approvedArgs)
        : null;
    const plan = planToolExecution(policy, { mode: requestedMode });

    // 稽核是旁路觀察：寫不進去也不能影響工具執行結果。
    const emitAudit = (record) => {
        if (!record || typeof onAudit !== 'function') {
            return;
        }
        try {
            const result = onAudit(record);
            if (result && typeof result.catch === 'function') {
                result.catch((error) => {
                    console.warn('[AskPage] Async tool audit callback failed:', error);
                });
            }
        } catch (error) {
            console.warn('[AskPage] Tool audit callback failed:', error);
        }
    };

    const blocked = ({
        message,
        approval = 'not-requested',
        precondition = null,
        error = null
    }) => {
        emitAudit(buildToolAuditRecord({
            id,
            name,
            policy,
            plan,
            approval,
            outcome: 'blocked',
            success: false,
            durationMs: 0,
            error
        }));
        if (typeof createBlockedResult === 'function') {
            return createBlockedResult({
                id,
                name,
                message,
                policy,
                plan,
                approval,
                precondition,
                error
            });
        }
        return {
            id,
            name,
            blocked: true,
            message,
            approval,
            precondition,
            risk: policy?.risk || 'unknown'
        };
    };

    if (plan.decision === EXECUTION_DECISION.BLOCK) {
        return blocked({
            message: `Tool ${name} is blocked because no enforceable policy is available.`,
            approval: 'not-available',
            error: plan.reason
        });
    }

    let approval = 'not-requested';
    let approvalResult;

    if (plan.decision === EXECUTION_DECISION.REQUIRE_APPROVAL) {
        // 沒有核准機制就擋下，不可當作核准。
        if (typeof requestApproval !== 'function') {
            return blocked({
                message: `Tool ${name} requires explicit approval.`,
                approval: 'unavailable',
                error: 'missing-approval-handler'
            });
        }

        try {
            approvalResult = await awaitWithCancellation(
                requestApproval({
                    id,
                    name,
                    args: approvedArgs,
                    policy,
                    plan
                }),
                signal
            );
        } catch (error) {
            // 取消要往外拋，否則會被當成「核准失敗」而吞掉取消語意。
            if (isCancellationError(error)) {
                throw error;
            }
            return blocked({
                message: `Tool ${name} approval failed.`,
                approval: 'error',
                error: error?.message || String(error)
            });
        }

        approval = approvalResult === true || approvalResult?.approved === true
            ? 'approved'
            : 'denied';

        if (approval !== 'approved') {
            return blocked({
                message: `Tool ${name} was not approved.`,
                approval
            });
        }

        // 核准不等於目標沒變。執行前一定要重新確認 target/precondition。
        if (typeof validatePrecondition !== 'function') {
            return blocked({
                message: `Tool ${name} lacks post-approval precondition validation.`,
                approval,
                precondition: 'unavailable',
                error: 'missing-precondition-validator'
            });
        }

        try {
            const preconditionResult = await awaitWithCancellation(
                validatePrecondition({
                    id,
                    name,
                    args: approvedArgs,
                    policy,
                    plan,
                    approvalResult
                }),
                signal
            );
            const valid = preconditionResult === true || preconditionResult?.valid === true;
            if (!valid) {
                return blocked({
                    message: `Tool ${name} precondition was rejected.`,
                    approval,
                    precondition: 'rejected',
                    error: 'precondition-rejected'
                });
            }
        } catch (error) {
            if (isCancellationError(error)) {
                throw error;
            }
            return blocked({
                message: `Tool ${name} precondition validation failed.`,
                approval,
                precondition: 'error',
                error: error?.message || String(error)
            });
        }
    }

    if (typeof execute !== 'function') {
        return blocked({
            message: `Tool ${name} has no execution handler.`,
            approval,
            error: 'missing-execution-handler'
        });
    }

    const startedAt = Date.now();
    let response;
    let executionError = null;
    try {
        response = await execute({
            ...toolCall,
            args: approvedArgs
        });
        return response;
    } catch (error) {
        executionError = error;
        throw error;
    } finally {
        emitAudit(buildToolAuditRecord({
            id,
            name,
            policy,
            plan,
            approval,
            outcome: executionError ? 'error' : 'executed',
            success: typeof response?.result?.success === 'boolean'
                ? response.result.success
                : null,
            durationMs: Date.now() - startedAt,
            error: executionError?.message || null
        }));
    }
}

const AskPageToolGovernance = Object.freeze({
    GOVERNANCE_MODE,
    EXECUTION_DECISION,
    normalizeGovernanceMode,
    snapshotToolArguments,
    planToolExecution,
    buildToolAuditRecord,
    shouldBlockWithoutApproval,
    executeGovernedToolCall
});

if (typeof globalThis !== 'undefined') {
    globalThis.AskPageToolGovernance = AskPageToolGovernance;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AskPageToolGovernance;
}
