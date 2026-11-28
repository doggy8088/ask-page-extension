'use strict';

const assert = require('assert');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const compactor = require(path.join(rootDir, 'src', 'lib', 'context-compaction.js'));

const HEADER = compactor.COMPACTION_SUMMARY_HEADER;
const ACK = compactor.COMPACTION_ACK_TEXT;
const PREVIOUS = 'Goals:\n- 整理第 3 節\nFacts:\n- 第 3 節有 4 個小節';

function summaryBlock(text) {
    return compactor.formatCompactionSummaryBlock(text);
}

function countSummaryItems(items) {
    return items.filter((item) => JSON.stringify(item).includes(HEADER)).length;
}

function cloneViaJson(items) {
    return JSON.parse(JSON.stringify(items));
}

function openAiItems() {
    return [
        { role: 'user', content: summaryBlock(PREVIOUS) },
        { role: 'assistant', content: ACK },
        { role: 'user', content: '第一個新問題' },
        { role: 'assistant', content: '第一個新回答' },
        { role: 'user', content: '第二個新問題' },
        { role: 'assistant', content: '第二個新回答' },
        { role: 'user', content: '第三個新問題' }
    ];
}

async function run() {
    // 1. OpenAI：舊摘要被抽出合併，不進轉錄稿，輸出只有一份摘要。
    let captured = null;
    const openaiResult = await compactor.compactWorkingContext({
        format: 'openai',
        items: openAiItems(),
        prefixItem: { role: 'system', content: '頁面內容' },
        systemPrompt: '',
        effectiveContextWindow: 4096,
        maxOutputTokens: 1024,
        useTools: false,
        requestSummary: async ({ systemPrompt, userPrompt }) => {
            captured = { systemPrompt, userPrompt };
            return 'Goals:\n- 整理第 3 節\nFacts:\n- 舊事實\n- 新事實';
        }
    });

    assert.ok(captured, '應呼叫 LLM 摘要');
    assert.match(captured.userPrompt, /Previous summary to merge:/, '提示要標明是合併既有摘要');
    assert.match(captured.userPrompt, /整理第 3 節/, '舊摘要本文要進提示');
    assert.doesNotMatch(captured.userPrompt, new RegExp(HEADER.replace(/[[\]]/g, '\\$&')), '轉錄稿不可再包含摘要標頭');
    assert.doesNotMatch(captured.systemPrompt, /Understood\. I will continue/, '確認訊息不可進轉錄稿');
    assert.strictEqual(countSummaryItems(openaiResult.items), 1, '重組後只能有一份摘要');
    assert.strictEqual(openaiResult.usedLlmSummary, true);

    // 2. 沒有可壓縮內容時原樣保留舊摘要，且不呼叫 LLM。
    let called = false;
    const idempotent = await compactor.compactWorkingContext({
        format: 'openai',
        items: [{ role: 'user', content: summaryBlock(PREVIOUS) }],
        prefixItem: null,
        systemPrompt: '',
        effectiveContextWindow: 4096,
        maxOutputTokens: 1024,
        useTools: false,
        requestSummary: async () => {
            called = true;
            return '不應被呼叫';
        }
    });
    assert.strictEqual(called, false);
    assert.strictEqual(countSummaryItems(idempotent.items), 1);
    assert.match(JSON.stringify(idempotent.items), /整理第 3 節/, '舊摘要內容不可消失');
    assert.strictEqual(idempotent.usedLlmSummary, false);

    // 3. 摘要訊息被 JSON 複製（內部標記遺失）時，仍要用標頭辨識出來。
    let fallbackCaptured = null;
    const cloned = await compactor.compactWorkingContext({
        format: 'openai',
        items: cloneViaJson(openAiItems()),
        prefixItem: null,
        systemPrompt: '',
        effectiveContextWindow: 4096,
        maxOutputTokens: 1024,
        useTools: false,
        requestSummary: async ({ userPrompt }) => {
            fallbackCaptured = userPrompt;
            return '合併結果';
        }
    });
    assert.match(fallbackCaptured, /Previous summary to merge:/, '標記遺失時仍要偵測到摘要');
    assert.doesNotMatch(fallbackCaptured, /User: \[AskPage Context Summary\]/);
    assert.strictEqual(countSummaryItems(cloned.items), 1);

    // 4. 內部標記不可列舉，不會出現在送給 API 的 payload。
    const markedItems = compactor.assembleCompactedMessages({
        format: 'openai',
        prefixItem: null,
        summaryText: '標記測試',
        keptTailItems: [{ role: 'user', content: '尾巴' }]
    });
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(markedItems[0])),
        { role: 'user', content: summaryBlock('標記測試') },
        '標記不可進入序列化後的訊息'
    );

    // 5. Anthropic：摘要仍是一則 user 訊息，且 tool_use 與 tool_result 保持配對。
    const anthropicItems = [
        { role: 'user', content: summaryBlock(PREVIOUS) },
        { role: 'assistant', content: ACK },
        { role: 'user', content: '看一下表單' },
        { role: 'assistant', content: [{ type: 'text', text: '我來讀取' }] },
        { role: 'user', content: '好' }
    ];
    let anthropicPrompt = null;
    const anthropicResult = await compactor.compactWorkingContext({
        format: 'anthropic',
        items: anthropicItems,
        prefixItem: null,
        systemPrompt: 'SYSTEM',
        effectiveContextWindow: 4096,
        maxOutputTokens: 1024,
        useTools: true,
        requestSummary: async ({ userPrompt }) => {
            anthropicPrompt = userPrompt;
            return '合併後摘要';
        }
    });
    assert.match(anthropicPrompt, /Previous summary to merge:/);
    assert.strictEqual(anthropicResult.items[0].role, 'user', 'Anthropic 必須以 user 開頭');
    assert.ok(
        String(anthropicResult.items[0].content).startsWith(HEADER),
        '第一則必須是摘要'
    );
    assert.strictEqual(countSummaryItems(anthropicResult.items), 1);
    const lastAssistant = anthropicResult.items.filter((item) => item.role === 'assistant').pop();
    assert.ok(lastAssistant, '尾巴的 assistant 應保留');

    // 6. Gemini：摘要步驟要留在最前面且只有一份。
    const geminiItems = [
        { type: 'user_input', content: [{ type: 'text', text: summaryBlock(PREVIOUS) }] },
        { type: 'model_output', content: [{ type: 'text', text: ACK }] },
        { type: 'user_input', content: [{ type: 'text', text: '新問題一' }] },
        { type: 'model_output', content: [{ type: 'text', text: '新回答一' }] },
        { type: 'user_input', content: [{ type: 'text', text: '新問題二' }] }
    ];
    let geminiPrompt = null;
    const geminiResult = await compactor.compactWorkingContext({
        format: 'gemini',
        items: geminiItems,
        prefixItem: null,
        systemPrompt: 'SYSTEM',
        effectiveContextWindow: 4096,
        maxOutputTokens: 1024,
        useTools: false,
        requestSummary: async ({ userPrompt }) => {
            geminiPrompt = userPrompt;
            return 'Gemini 合併摘要';
        }
    });
    assert.match(geminiPrompt, /Previous summary to merge:/);
    assert.strictEqual(geminiResult.items[0].type, 'user_input');
    assert.strictEqual(countSummaryItems(geminiResult.items), 1);

    // 7. LLM 失敗時退回規則摘要，但不可丟掉舊摘要。
    const fallbackResult = await compactor.compactWorkingContext({
        format: 'openai',
        items: openAiItems(),
        prefixItem: null,
        systemPrompt: '',
        effectiveContextWindow: 4096,
        maxOutputTokens: 1024,
        useTools: false,
        requestSummary: async () => {
            throw new Error('摘要模型掛了');
        }
    });
    assert.strictEqual(fallbackResult.usedLlmSummary, false);
    assert.match(fallbackResult.summaryText, /整理第 3 節/, '規則摘要也要保留舊摘要內容');
    assert.match(fallbackResult.summaryText, /User: 第一個新問題/, '規則摘要要納入新內容');

    // 8. 提示規則：合併模式要說明「不得重複、不得丟棄仍有效的目標」。
    const merged = compactor.buildCompactionPrompt('User: x', PREVIOUS);
    assert.match(merged.systemPrompt, /Merge it with the new history into ONE summary/);
    assert.match(merged.systemPrompt, /never drop an earlier goal or constraint/);
    const plain = compactor.buildCompactionPrompt('User: x');
    assert.doesNotMatch(plain.systemPrompt, /Merge it with the new history/);
    assert.match(plain.userPrompt, /^Compact the following/);

    console.log('compaction-summary-merge: ok');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
