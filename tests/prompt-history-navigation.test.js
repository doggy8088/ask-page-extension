'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const contentScript = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

function sliceSource(startMarker, endMarker) {
    const start = contentScript.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `找不到 ${startMarker}`);
    const end = contentScript.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, `找不到 ${endMarker}`);
    return contentScript.slice(start, end);
}

const navigateSource = sliceSource('function navigatePromptHistory(', 'function clearCompositionEndGuard(');

function createHarness(history, initialValue = '') {
    const context = {
        input: { value: initialValue },
        promptHistory: history.slice(),
        historyIndex: history.length,
        promptDraft: '',
        setInputValue(value) {
            context.input.value = value;
        }
    };
    vm.createContext(context);
    vm.runInContext(`${navigateSource}\nthis.navigatePromptHistory = navigatePromptHistory;`, context);
    return context;
}

// 1. 在草稿位置按 ArrowDown 不可清掉正在輸入的提示詞
{
    const ctx = createHarness(['舊問題一', '舊問題二'], '正在輸入的新問題');
    ctx.navigatePromptHistory(1);
    assert.strictEqual(ctx.input.value, '正在輸入的新問題', 'ArrowDown 不可清空尚未送出的提示詞');
    assert.strictEqual(ctx.historyIndex, 2);
}

// 2. ArrowUp 瀏覽歷史後，ArrowDown 回到底部要還原原本的草稿
{
    const ctx = createHarness(['舊問題一', '舊問題二'], '正在輸入的新問題');
    ctx.navigatePromptHistory(-1);
    assert.strictEqual(ctx.input.value, '舊問題二');
    ctx.navigatePromptHistory(-1);
    assert.strictEqual(ctx.input.value, '舊問題一');
    ctx.navigatePromptHistory(-1);
    assert.strictEqual(ctx.input.value, '舊問題一', '已在最舊一筆時 ArrowUp 不變');
    ctx.navigatePromptHistory(1);
    assert.strictEqual(ctx.input.value, '舊問題二');
    ctx.navigatePromptHistory(1);
    assert.strictEqual(ctx.input.value, '正在輸入的新問題', '回到底部要還原草稿');
    ctx.navigatePromptHistory(1);
    assert.strictEqual(ctx.input.value, '正在輸入的新問題', '草稿位置再按 ArrowDown 不變');
}

// 3. 沒有歷史紀錄時上下鍵都不可動到輸入內容
{
    const ctx = createHarness([], '草稿');
    ctx.navigatePromptHistory(-1);
    ctx.navigatePromptHistory(1);
    assert.strictEqual(ctx.input.value, '草稿');
}

// 4. keydown 處理器必須改用 navigatePromptHistory，不可再直接清空輸入框
assert.match(contentScript, /shouldUsePromptHistoryNavigation\('ArrowUp'\)\) \{\s*e\.preventDefault\(\);\s*navigatePromptHistory\(-1\);/);
assert.match(contentScript, /shouldUsePromptHistoryNavigation\('ArrowDown'\)\) \{\s*e\.preventDefault\(\);\s*navigatePromptHistory\(1\);/);

console.log('prompt-history-navigation.test.js passed');
