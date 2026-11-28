'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const compactor = require(path.join(rootDir, 'src', 'lib', 'context-compaction.js'));
const contentScript = fs.readFileSync(path.join(rootDir, 'src', 'content.js'), 'utf8');
const zhTwCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, 'src', '_locales', 'zh_TW', 'messages.json'), 'utf8'));

function sliceSource(startMarker, endMarker) {
    const start = contentScript.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `找不到 ${startMarker}`);
    const end = contentScript.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, `找不到 ${endMarker}`);
    return contentScript.slice(start, end);
}

async function run() {
    // B1：抽取後沒有可摘要文字時，仍要留下說明，不能讓舊回合無聲消失。
    const thinkingOnly = { role: 'assistant', content: [{ type: 'thinking', thinking: '思考中', signature: 'sig' }] };
    const emptyResult = await compactor.compactWorkingContext({
        format: 'anthropic',
        items: [thinkingOnly, thinkingOnly, thinkingOnly],
        prefixItem: null,
        systemPrompt: 'SYS',
        effectiveContextWindow: 8000,
        maxOutputTokens: 2048,
        useTools: false,
        requestSummary: async () => {
            throw new Error('轉錄稿為空時不應呼叫 LLM 摘要');
        }
    });
    assert.ok(emptyResult.summaryText, '空白轉錄稿仍要產生摘要文字');
    assert.match(emptyResult.summaryText, /contained no summarizable text/);
    assert.strictEqual(emptyResult.usedLlmSummary, false);
    assert.ok(
        emptyResult.items.some((item) => JSON.stringify(item).includes('[AskPage Context Summary]')),
        '訊息中必須有摘要區塊，否則模型不知道舊回合被丟棄'
    );

    // 對照：有實質文字時走既有路徑。
    const withText = await compactor.compactWorkingContext({
        format: 'openai',
        items: [
            { role: 'user', content: '第一題' },
            { role: 'assistant', content: '第一答' },
            { role: 'user', content: '第二題' },
            { role: 'assistant', content: '第二答' },
            { role: 'user', content: '第三題' },
            { role: 'assistant', content: '第三答' }
        ],
        prefixItem: null,
        systemPrompt: '',
        effectiveContextWindow: 4096,
        maxOutputTokens: 1024,
        useTools: false,
        requestSummary: async () => '使用者依序詢問了三題。'
    });
    assert.strictEqual(withText.usedLlmSummary, true);
    assert.strictEqual(withText.summaryText, '使用者依序詢問了三題。');

    // B2：未使用的比例常數不應再匯出。
    assert.strictEqual(compactor.COMPACTION_TARGET_RATIO, undefined, 'COMPACTION_TARGET_RATIO 應已移除');
    assert.strictEqual(compactor.AUTO_COMPACTION_THRESHOLD_RATIO, 0.8);

    // B3：錯誤原文只給使用者，模型看到中性失敗標記。
    const history = [];
    const appended = [];
    const errorSandbox = {
        console,
        conversationHistory: history,
        getLocalizedText(key, substitutions = {}) {
            const message = zhTwCatalog[key]?.message || key;
            return message.replace(/\$([A-Za-z][A-Za-z0-9_]*)\$/g, (match, name) => substitutions[name] ?? match);
        },
        getAssistantStoredText: (text) => text,
        appendPersistentMessage(role, text, options = {}, historyOptions = {}) {
            appended.push({ role, text, options, historyOptions });
        },
        globalThis: null
    };
    errorSandbox.globalThis = errorSandbox;
    errorSandbox.AskPageDebug = { record() {} };
    vm.createContext(errorSandbox);
    vm.runInContext(`
${sliceSource('    function appendErrorMessageAndStore(', '    // 使用者終止回合後')}
this.appendErrorMessageAndStore = appendErrorMessageAndStore;
`, errorSandbox);

    history.push({ role: 'user', content: '幫我整理這頁' });
    errorSandbox.appendErrorMessageAndStore('錯誤：Ollama Cloud 已達輸出上限');
    assert.strictEqual(appended.length, 1);
    assert.strictEqual(appended[0].text, '錯誤：Ollama Cloud 已達輸出上限', 'UI 要顯示原始錯誤');
    assert.strictEqual(appended[0].historyOptions.displayContent, undefined, '顯示文字沿用 UI 已處理的錯誤訊息');
    assert.match(appended[0].historyOptions.content, /這一輪發生錯誤/, '模型只看到中性失敗標記');
    assert.notStrictEqual(appended[0].historyOptions.content, appended[0].text, '模型內容不可等於錯誤原文');
    assert.strictEqual(appended[0].historyOptions.includeInModelContext, undefined, '標記要進模型上下文');

    // 沒有待答問題時不可把錯誤寫進上下文，避免出現以 assistant 開頭的對話。
    history.push({ role: 'assistant', content: '先前回覆' });
    errorSandbox.appendErrorMessageAndStore('錯誤：尚未設定供應商');
    assert.strictEqual(appended[1].historyOptions.includeInModelContext, false);
    assert.strictEqual(appended[1].historyOptions.content, undefined);

    // A：三個壓縮點都要留下診斷記錄。
    assert.strictEqual(
        (contentScript.match(/logCompactionDiagnostic\('(?:openai|gemini|anthropic)', compacted, \{ isOverflowRecovery, overflowAttempt \}\);/g) || []).length,
        3,
        'OpenAI、Gemini、Anthropic 壓縮後都要記錄診斷'
    );

    const diagnostics = [];
    const diagSandbox = {
        console,
        logDiagnostic(level, message, details) {
            diagnostics.push({ level, message, details });
        }
    };
    vm.createContext(diagSandbox);
    vm.runInContext(`
${sliceSource('    function logCompactionDiagnostic(', '    function shouldSuppressStreamingRetryDiagnostic(')}
this.logCompactionDiagnostic = logCompactionDiagnostic;
`, diagSandbox);
    diagSandbox.logCompactionDiagnostic('openai', {
        beforeTokens: 90000,
        afterTokens: 21000,
        usedLlmSummary: true,
        compactableItemCount: 7,
        summaryText: '摘要內容'
    }, { isOverflowRecovery: true, overflowAttempt: 2 });

    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].level, 'info');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(diagnostics[0].details)), {
        format: 'openai',
        beforeTokens: 90000,
        afterTokens: 21000,
        usedLlmSummary: true,
        compactableItemCount: 7,
        summaryChars: 4,
        isOverflowRecovery: true,
        overflowAttempt: 2
    });

    // C1：摘要提示要禁止臆測並要求保留原始識別資訊。
    const prompt = compactor.buildCompactionPrompt('User: 測試');
    assert.match(prompt.systemPrompt, /Never invent or infer details/);
    assert.match(prompt.systemPrompt, /write "unknown"/);
    assert.match(prompt.systemPrompt, /element refs exactly as written/);
    assert.match(prompt.systemPrompt, /Goals, Facts, Tool calls, Pending/);
    assert.match(prompt.userPrompt, /User: 測試$/);

    // 語系字串齊備。
    assert.ok(zhTwCatalog.turnFailedNotice);
    assert.match(zhTwCatalog.turnFailedNotice.message, /錯誤/);

    console.log('compaction-robustness: ok');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
