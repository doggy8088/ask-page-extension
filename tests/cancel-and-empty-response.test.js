'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const contentScript = fs.readFileSync(path.join(rootDir, 'src', 'content.js'), 'utf8');
const zhTwCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, 'src', '_locales', 'zh_TW', 'messages.json'), 'utf8'));

function sliceSource(startMarker, endMarker) {
    const start = contentScript.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `找不到 ${startMarker}`);
    const end = contentScript.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, `找不到 ${endMarker}`);
    return contentScript.slice(start, end);
}

// 1. 空回覆重試策略：只有上限真的能放大才重試 length 情境，否則直接回報可行動的錯誤。
const planSandbox = { console };
vm.createContext(planSandbox);
vm.runInContext(`
${sliceSource('    function planOpenAIStyleEmptyResponseRetry(', '    function buildOpenAIStyleEmptyResponseMessage(')}
this.planOpenAIStyleEmptyResponseRetry = planOpenAIStyleEmptyResponseRetry;
`, planSandbox);

const { planOpenAIStyleEmptyResponseRetry } = planSandbox;
assert.strictEqual(
    planOpenAIStyleEmptyResponseRetry('length', 32768, 32768),
    'fail-output-limit',
    '上限無法放大時不可重試同一個請求'
);
assert.strictEqual(
    planOpenAIStyleEmptyResponseRetry('length', 8192, 32768),
    'retry-with-larger-limit',
    '上限被壓縮夾低時要還原後重試'
);
assert.strictEqual(planOpenAIStyleEmptyResponseRetry('stop', 32768, 32768), 'retry-empty');
assert.strictEqual(planOpenAIStyleEmptyResponseRetry('', 32768, 32768), 'retry-empty');

// 2. 終止標記：不顯示在 UI，但要進模型上下文；重複終止不可堆疊多則。
const history = [];
const appendedErrors = [];
const turnSandbox = {
    console,
    conversationHistory: history,
    getLocalizedText(key, substitutions = {}) {
        const message = zhTwCatalog[key]?.message || key;
        return message.replace(/\$([A-Za-z][A-Za-z0-9_]*)\$/g, (match, name) => substitutions[name] ?? match);
    },
    addConversationTurn(role, content, displayContent = content, options = {}) {
        const turn = { role, content, displayContent, ...options };
        history.push(turn);
        return turn;
    },
    appendPersistentMessage(role, text, options = {}, historyOptions = {}) {
        appendedErrors.push({ role, text, options, historyOptions });
    }
};
vm.createContext(turnSandbox);
vm.runInContext(`
${sliceSource('    function appendErrorMessageAndStore(', '    function sleep(ms, signal = null) {')}
this.appendErrorMessageAndStore = appendErrorMessageAndStore;
this.appendCancelledTurnNotice = appendCancelledTurnNotice;
`, turnSandbox);

turnSandbox.appendCancelledTurnNotice();
assert.strictEqual(history.length, 0, '沒有待答問題時不應寫入終止標記');

history.push({ role: 'user', content: '幫我整理這頁', includeInModelContext: true });
const notice = turnSandbox.appendCancelledTurnNotice();
assert.ok(notice, '取消後要寫入一則終止標記');
assert.strictEqual(notice.role, 'assistant');
assert.strictEqual(notice.includeInModelContext, true, '終止標記必須進模型上下文');
assert.strictEqual(notice.hiddenFromUi, true, '終止標記不可顯示在 UI');
assert.strictEqual(notice.suppressCopyButton, true);
assert.match(notice.content, /已終止這一輪/);

turnSandbox.appendCancelledTurnNotice();
assert.strictEqual(history.length, 2, '上一則已是助理回合時不可再補標記');

// 3. 錯誤訊息只顯示給使用者，不進模型上下文。
turnSandbox.appendErrorMessageAndStore('錯誤：Ollama Cloud 已達輸出上限');
assert.strictEqual(appendedErrors.length, 1);
assert.strictEqual(appendedErrors[0].historyOptions.includeInModelContext, false);

// 4. 五個供應商路徑的取消分支都要補上標記。
const cancelBranches = contentScript.match(
    /if \(isAskTaskCancellationError\(error\)\) \{[\s\S]*?appendCancelledTurnNotice\(\);[\s\S]*?return;/g
) || [];
assert.strictEqual(cancelBranches.length, 5, 'Gemini、OpenAI、Azure、OpenAI 相容、Anthropic 的取消分支都要寫入終止標記');

// 5. 對話紀錄重建時略過不顯示的回合，避免重開對話框出現多餘訊息。
assert.match(
    contentScript,
    /conversationHistory\.forEach\(\(turn\) => \{\s*if \(turn\.hiddenFromUi\) \{\s*return;\s*\}/,
    '重開對話框渲染歷史時必須略過 hiddenFromUi 回合'
);
assert.match(
    sliceSource('function addConversationTurn(', 'function truncateConversationFromTurn('),
    /hiddenFromUi: options\.hiddenFromUi === true/,
    'addConversationTurn 必須保存 hiddenFromUi 標記'
);

// 6. 主迴圈必須照策略走，不再無條件重試 length 空回覆。
assert.match(
    contentScript,
    /planOpenAIStyleEmptyResponseRetry\(\s*finishReason,\s*requestMaxOutputTokens,\s*raisedRequestMaxOutputTokens\s*\)/,
    '重試判斷要比較這一輪與放大後實際送出的上限'
);
assert.match(
    contentScript,
    /raisedRequestMaxOutputTokens = canCompact\s*\?\s*compactor\.computeSafeMaxOutputTokens\(/,
    '放大後的上限仍要經過視窗安全上限計算，避免誤判為可放大'
);
assert.match(
    contentScript,
    /retryPlan !== 'fail-output-limit'[\s\S]*?isOpenAIStyleRetriableEmptyResponse\(responseData\)/
);
assert.match(
    contentScript,
    /retryPlan === 'retry-with-larger-limit'[\s\S]*?statusEmptyResponseOutputLimitRetry/
);

// 7. 輸出上限錯誤訊息要指出可能原因，而不是只叫使用者縮小問題。
assert.match(zhTwCatalog.openaiOutputLimit.message, /思考/);
assert.strictEqual(zhTwCatalog.statusGeminiOutputLimitRetry, undefined, '未使用的 Gemini 輸出上限重試文案應移除');
assert.ok(zhTwCatalog.turnCancelledNotice, '終止標記需要語系字串');

console.log('cancel-and-empty-response: ok');
